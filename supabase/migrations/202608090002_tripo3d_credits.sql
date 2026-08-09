-- Adds Tripo3D to the durable Butler credit ledger. Image-to-model uses the
-- standard textured PBR tier and is sold for a fixed 10 application points.

alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_supported;
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_supported check (provider_id in (
    'background-remove',
    'qwen-image-edit-plus',
    'qwen-image-layered',
    'super-upscale-v2',
    'erase',
    'hunyuan3d',
    'hyper3d',
    'tripo3d',
    'topaz-video-upscale'
  ));

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
    when normalized_provider in ('hunyuan3d', 'hyper3d', 'tripo3d') then '3d'
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
    when 'tripo3d' then 10
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

revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer) from public;
revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer) from anon;
revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer) from authenticated;
grant execute on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer) to service_role;
