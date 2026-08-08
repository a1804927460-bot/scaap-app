-- Server-authoritative retail pricing for Seedance and every paid Butler tool.
-- Fixed-price tools never accept an upstream cost from the gateway. Topaz
-- remains dynamically priced from provider points so existing audit rows stay
-- compatible. Failed tool jobs release their full reservation atomically.

alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage
  add constraint ai_usage_kind_check check (kind in ('chat', 'image', 'video', '3d'));

alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_id_check;
alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_supported;
alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_cost_mode_check;
alter table public.ai_tool_jobs alter column provider_cost drop not null;
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_supported check (provider_id in (
    'background-remove',
    'qwen-image-edit-plus',
    'qwen-image-layered',
    'super-upscale-v2',
    'erase',
    'hunyuan3d',
    'hyper3d',
    'topaz-video-upscale'
  ));
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_cost_mode_check check (
    (provider_id = 'topaz-video-upscale' and provider_cost is not null)
    or (provider_id <> 'topaz-video-upscale' and provider_cost is null)
  );

create or replace function public.reserve_ai_credits(
  p_user_id uuid,
  p_kind text,
  p_provider_id text,
  p_request_id uuid,
  p_resolution text default null,
  p_duration integer default null,
  p_expected_credits integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_kind text := lower(trim(coalesce(p_kind, '')));
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text;
  normalized_duration integer;
  quoted_credits integer;
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
  stale_record record;
begin
  if normalized_kind = 'chat' then
    if normalized_provider = '' then normalized_provider := 'chat-1'; end if;
    if normalized_provider !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    quoted_credits := 0;
  elsif normalized_kind = 'image' then
    if normalized_provider = '' then normalized_provider := 'image-1'; end if;
    if normalized_provider = 'image-6' then
      normalized_resolution := lower(trim(coalesce(p_resolution, 'auto')));
      if normalized_resolution not in ('low', 'medium', 'high', 'auto') then
        normalized_resolution := 'auto';
      end if;
      quoted_credits := case normalized_resolution
        when 'low' then 3
        when 'medium' then 8
        when 'high' then 28
        else 12
      end;
    else
      quoted_credits := case normalized_provider
        when 'image-1' then 16
        when 'image-2' then 7
        when 'image-3' then 5
        when 'image-4' then 4
        when 'image-5' then 8
        else null
      end;
    end if;
    if quoted_credits is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
    if normalized_provider = 'video-1' then
      normalized_resolution := case
        when upper(trim(coalesce(p_resolution, ''))) = '2K' then '2K'
        else '768P'
      end;
      quoted_credits := (case normalized_resolution when '2K' then 16 else 10 end) * normalized_duration;
    elsif normalized_provider = 'video-2' then
      normalized_resolution := case
        when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P'
        else '720P'
      end;
      quoted_credits := (case normalized_resolution when '480P' then 3 else 5 end) * normalized_duration;
    elsif normalized_provider = 'video-3' then
      normalized_resolution := case
        when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P'
        else '720P'
      end;
      quoted_credits := (case normalized_resolution when '480P' then 4 else 6 end) * normalized_duration;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  if p_expected_credits is not null and p_expected_credits <> quoted_credits then
    return jsonb_build_object('ok', false, 'reason', 'pricing-mismatch', 'credits', quoted_credits);
  end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id;
  if quota_record.suspended then
    return jsonb_build_object('ok', false, 'reason', 'account-suspended');
  end if;

  for stale_record in
    select usage_row.request_id, usage_row.credits_reserved
    from public.ai_usage as usage_row
    where usage_row.user_id = p_user_id
      and usage_row.status = 'reserved'
      and usage_row.credits_reserved > 0
      and usage_row.created_at < now() - interval '30 minutes'
      and not exists (
        select 1
        from public.ai_video_jobs as video_job
        where video_job.request_id = usage_row.request_id
          and video_job.status in ('starting', 'submitted', 'polling')
          and video_job.deadline_at > now()
      )
      and not exists (
        select 1
        from public.ai_tool_jobs as tool_job
        where tool_job.request_id = usage_row.request_id
          and tool_job.status = 'processing'
          and tool_job.updated_at >= now() - interval '30 minutes'
      )
    order by usage_row.created_at
    for update of usage_row
  loop
    update public.ai_credit_accounts
    set reserved = greatest(0, reserved - stale_record.credits_reserved), updated_at = now()
    where user_id = p_user_id returning * into account_record;
    update public.ai_usage
    set status = 'failed', completed_at = now(), duration_ms = null
    where request_id = stale_record.request_id;
    update public.ai_tool_jobs
    set status = 'failed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where request_id = stale_record.request_id and status = 'processing';
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'expire', 0, -stale_record.credits_reserved, account_record.balance,
       account_record.reserved, stale_record.request_id, stale_record.request_id::text,
       'expire:' || stale_record.request_id::text, '{}'::jsonb)
    on conflict (user_id, idempotency_key) do nothing;
  end loop;

  select * into usage_record from public.ai_usage where request_id = p_request_id for update;
  if found then
    if usage_record.user_id <> p_user_id
       or usage_record.kind <> normalized_kind
       or coalesce(usage_record.provider_id, '') <> normalized_provider
       or coalesce(usage_record.resolution, '') <> coalesce(normalized_resolution, '')
       or usage_record.credits_reserved <> quoted_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', false,
      'reason', 'request-id-conflict',
      'credits', quoted_credits,
      'balance', account_record.balance,
      'reserved', account_record.reserved,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  if account_record.balance - account_record.reserved < quoted_credits then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient-credits',
      'credits', quoted_credits,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, normalized_kind, normalized_provider,
     normalized_resolution, normalized_duration, quoted_credits);

  if quoted_credits > 0 then
    update public.ai_credit_accounts
    set reserved = reserved + quoted_credits, updated_at = now()
    where user_id = p_user_id returning * into account_record;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'reserve', 0, quoted_credits, account_record.balance, account_record.reserved,
       p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
       jsonb_build_object('kind', normalized_kind, 'providerId', normalized_provider,
                          'resolution', normalized_resolution, 'duration', normalized_duration));
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'reserved',
    'credits', quoted_credits,
    'balance', account_record.balance,
    'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved
  );
end;
$$;

create or replace function public.reserve_ai_tool_credits(
  p_user_id uuid,
  p_request_id uuid,
  p_provider_id text,
  p_credits integer,
  p_provider_cost integer,
  p_resolution text default null,
  p_duration integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := nullif(left(trim(coalesce(p_resolution, '')), 32), '');
  normalized_duration integer := case when p_duration is null then null else greatest(1, least(21600, p_duration)) end;
  usage_kind text;
  expected_credits integer;
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
  job_record public.ai_tool_jobs%rowtype;
  stale_record record;
begin
  usage_kind := case
    when normalized_provider = 'topaz-video-upscale' then 'video'
    when normalized_provider in ('hunyuan3d', 'hyper3d') then '3d'
    when normalized_provider in (
      'background-remove', 'qwen-image-edit-plus', 'qwen-image-layered',
      'super-upscale-v2', 'erase'
    ) then 'image'
    else null
  end;
  expected_credits := case normalized_provider
    when 'background-remove' then 1
    when 'qwen-image-edit-plus' then 2
    when 'qwen-image-layered' then 1
    when 'super-upscale-v2' then 2
    when 'erase' then 1
    when 'hunyuan3d' then 8
    when 'hyper3d' then 14
    when 'topaz-video-upscale' then
      case
        when p_provider_cost between 0 and 1000000
          then ceil(p_provider_cost::numeric * 0.15 * 10 * 2)::integer
        else null
      end
    else null
  end;

  if usage_kind is null
     or expected_credits is null
     or p_credits is null
     or p_credits <> expected_credits
     or p_credits < 0
     or p_credits > 3000000
     or (normalized_provider = 'topaz-video-upscale' and p_provider_cost is null)
     or (normalized_provider <> 'topaz-video-upscale' and p_provider_cost is not null) then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id;
  if quota_record.suspended then
    return jsonb_build_object('ok', false, 'reason', 'account-suspended');
  end if;

  for stale_record in
    select usage_row.request_id, usage_row.credits_reserved
    from public.ai_usage as usage_row
    join public.ai_tool_jobs as tool_job on tool_job.request_id = usage_row.request_id
    where usage_row.user_id = p_user_id
      and usage_row.status = 'reserved'
      and usage_row.credits_reserved > 0
      and tool_job.status = 'processing'
      and tool_job.updated_at < now() - interval '30 minutes'
    order by tool_job.updated_at
    for update of usage_row, tool_job
  loop
    update public.ai_credit_accounts
    set reserved = greatest(0, reserved - stale_record.credits_reserved), updated_at = now()
    where user_id = p_user_id returning * into account_record;
    update public.ai_usage
    set status = 'failed', completed_at = now(), duration_ms = null
    where request_id = stale_record.request_id;
    update public.ai_tool_jobs
    set status = 'failed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where request_id = stale_record.request_id;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'expire', 0, -stale_record.credits_reserved, account_record.balance,
       account_record.reserved, stale_record.request_id, stale_record.request_id::text,
       'expire:' || stale_record.request_id::text, '{}'::jsonb)
    on conflict (user_id, idempotency_key) do nothing;
  end loop;

  select * into usage_record from public.ai_usage where request_id = p_request_id for update;
  if found then
    select * into job_record from public.ai_tool_jobs where request_id = p_request_id;
    if usage_record.user_id <> p_user_id
       or usage_record.kind <> usage_kind
       or coalesce(usage_record.provider_id, '') <> normalized_provider
       or coalesce(usage_record.resolution, '') <> coalesce(normalized_resolution, '')
       or usage_record.duration_seconds is distinct from normalized_duration
       or usage_record.credits_reserved <> expected_credits
       or not found
       or job_record.provider_cost is distinct from p_provider_cost
       or job_record.retail_credits <> expected_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', usage_record.status = 'reserved' and job_record.status = 'processing',
      'reason', case
        when usage_record.status = 'reserved' and job_record.status = 'processing' then 'already-reserved'
        else 'request-id-conflict'
      end,
      'credits', expected_credits,
      'providerCost', p_provider_cost,
      'balance', account_record.balance,
      'reserved', account_record.reserved,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  if account_record.balance - account_record.reserved < expected_credits then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient-credits',
      'credits', expected_credits,
      'providerCost', p_provider_cost,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, usage_kind, normalized_provider,
     normalized_resolution, normalized_duration, expected_credits);
  insert into public.ai_tool_jobs
    (request_id, user_id, provider_id, provider_cost, retail_credits)
  values
    (p_request_id, p_user_id, normalized_provider, p_provider_cost, expected_credits);

  if expected_credits > 0 then
    update public.ai_credit_accounts
    set reserved = reserved + expected_credits, updated_at = now()
    where user_id = p_user_id returning * into account_record;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'reserve', 0, expected_credits, account_record.balance, account_record.reserved,
       p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
       jsonb_strip_nulls(jsonb_build_object(
         'kind', usage_kind,
         'providerId', normalized_provider,
         'providerCost', p_provider_cost,
         'retailCredits', expected_credits,
         'resolution', normalized_resolution,
         'duration', normalized_duration
       )))
    on conflict (user_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'reserved',
    'credits', expected_credits,
    'providerCost', p_provider_cost,
    'balance', account_record.balance,
    'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved
  );
end;
$$;

create or replace function public.settle_ai_tool_credits(
  p_request_id uuid,
  p_user_id uuid,
  p_status text,
  p_duration_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_tool_jobs%rowtype;
  normalized_status text := case when p_status = 'succeeded' then 'succeeded' else 'failed' end;
  settlement jsonb;
begin
  select * into job from public.ai_tool_jobs
  where request_id = p_request_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if job.status <> 'processing' and job.status <> normalized_status then
    return jsonb_build_object('ok', false, 'reason', 'status-conflict', 'status', job.status);
  end if;
  settlement := public.settle_ai_credits(
    p_request_id,
    normalized_status,
    greatest(0, coalesce(p_duration_ms, 0))
  );
  if coalesce((settlement->>'ok')::boolean, false) is not true
     or coalesce(settlement->>'status', '') <> normalized_status then
    return settlement;
  end if;
  update public.ai_tool_jobs
  set status = normalized_status,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where request_id = p_request_id;
  return settlement;
end;
$$;

create or replace function public.get_ai_usage_summary(
  p_user_id uuid,
  p_range text default '7d'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_range text := lower(trim(coalesce(p_range, '7d')));
  today_utc date := (now() at time zone 'UTC')::date;
  period_start date;
  period_days integer;
  account_record public.ai_credit_accounts%rowtype;
  result jsonb;
begin
  if p_user_id is null then
    raise exception 'A user id is required.' using errcode = '22023';
  end if;
  normalized_range := case normalized_range
    when '7' then '7d'
    when '7d' then '7d'
    when '30' then '30d'
    when '30d' then '30d'
    when 'all' then 'all'
    else null
  end;
  if normalized_range is null then
    raise exception 'The usage range is invalid.' using errcode = '22023';
  end if;

  select * into account_record from public.ai_credit_accounts where user_id = p_user_id;
  if normalized_range = '7d' then
    period_start := today_utc - 6;
  elsif normalized_range = '30d' then
    period_start := today_utc - 29;
  else
    select least(
      coalesce((account_record.created_at at time zone 'UTC')::date, today_utc),
      coalesce(min((usage_row.created_at at time zone 'UTC')::date), today_utc)
    )
    into period_start
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id and usage_row.status = 'succeeded';
  end if;
  period_start := least(coalesce(period_start, today_utc), today_utc);
  period_days := greatest(1, today_utc - period_start + 1);

  with filtered as (
    select
      usage_row.kind,
      coalesce(nullif(trim(usage_row.provider_id), ''), 'unknown') as provider_id,
      greatest(0, coalesce(usage_row.credits_charged, 0))::integer as credits,
      (usage_row.created_at at time zone 'UTC')::date as usage_date
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id
      and usage_row.status = 'succeeded'
      and (usage_row.created_at at time zone 'UTC')::date between period_start and today_utc
  ),
  totals as (
    select
      coalesce(sum(credits), 0)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations,
      count(*)::bigint as requests
    from filtered
  ),
  type_names as (
    select unnest(array['chat', 'image', 'video', '3d']::text[]) as kind
  ),
  type_rows as (
    select
      type_names.kind,
      coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from type_names
    left join filtered on filtered.kind = type_names.kind
    group by type_names.kind
  ),
  daily_rows as (
    select
      day_value::date as usage_date,
      coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from generate_series(period_start, today_utc, interval '1 day') as day_value
    left join filtered on filtered.usage_date = day_value::date
    group by day_value::date
  ),
  model_rows as (
    select
      provider_id,
      kind,
      sum(credits)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations,
      count(*)::bigint as requests
    from filtered
    group by provider_id, kind
  )
  select jsonb_build_object(
    'range', normalized_range,
    'timeZone', 'UTC',
    'period', jsonb_build_object(
      'from', to_char(period_start, 'YYYY-MM-DD'),
      'to', to_char(today_utc, 'YYYY-MM-DD'),
      'days', period_days
    ),
    'account', jsonb_build_object(
      'balance', coalesce(account_record.balance, 0),
      'reserved', coalesce(account_record.reserved, 0),
      'availableCredits', greatest(0, coalesce(account_record.balance, 0) - coalesce(account_record.reserved, 0)),
      'membershipTier', coalesce(account_record.membership_tier, 'free')
    ),
    'totals', jsonb_build_object(
      'credits', totals.credits,
      'generations', totals.generations,
      'requests', totals.requests,
      'averagePerDay', round(totals.credits::numeric / period_days, 2)
    ),
    'byType', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', type_rows.kind,
        'credits', type_rows.credits,
        'generations', type_rows.generations,
        'requests', type_rows.requests
      ) order by array_position(array['image', 'video', '3d', 'chat']::text[], type_rows.kind))
      from type_rows
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(daily_rows.usage_date, 'YYYY-MM-DD'),
        'credits', daily_rows.credits,
        'generations', daily_rows.generations,
        'requests', daily_rows.requests
      ) order by daily_rows.usage_date)
      from daily_rows
    ), '[]'::jsonb),
    'byModel', coalesce((
      select jsonb_agg(model_item.payload order by model_item.credits desc, model_item.requests desc, model_item.provider_id)
      from (
        select
          model_rows.provider_id,
          model_rows.credits,
          model_rows.requests,
          jsonb_build_object(
            'providerId', model_rows.provider_id,
            'kind', model_rows.kind,
            'credits', model_rows.credits,
            'generations', model_rows.generations,
            'requests', model_rows.requests
          ) as payload
        from model_rows
        order by model_rows.credits desc, model_rows.requests desc, model_rows.provider_id
        limit 20
      ) model_item
    ), '[]'::jsonb),
    'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  into result
  from totals;
  return result;
end;
$$;

revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.settle_ai_tool_credits(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_ai_usage_summary(uuid, text)
  from public, anon, authenticated;

grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
grant execute on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;
grant execute on function public.settle_ai_tool_credits(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.get_ai_usage_summary(uuid, text)
  to service_role;
