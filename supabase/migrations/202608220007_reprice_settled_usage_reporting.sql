-- Report historical usage with the active retail policy without changing the
-- immutable credit ledger or account balances. A settled report is always the
-- higher of the historical settled debit and today's safe quote: no refund is
-- created when a policy update would otherwise make an old generation cheaper.

create or replace function public.current_policy_ai_usage_credits(
  p_request_id uuid,
  p_kind text,
  p_provider_id text,
  p_resolution text,
  p_duration integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_kind text := lower(trim(coalesce(p_kind, '')));
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  normalized_duration integer := coalesce(p_duration, 6);
  normalized_quality text;
  image_resolution text;
  upstream_points numeric;
  provider_cost integer;
  video_job public.ai_video_jobs%rowtype;
  billable_seconds integer;
  input_image_count integer;
  upstream_cny numeric;
begin
  -- Agent and AI chat are product-level free features.
  if normalized_kind = 'chat' then return 0; end if;

  -- 3D and capsule tools retain the current 10% buffer and 10% gross margin.
  -- Topaz cost is reported in Topaz points; 3D provider_cost is PTC cents.
  if normalized_provider like 'topaz-%' then
    select tool_job.provider_cost into provider_cost
    from public.ai_tool_jobs tool_job
    where tool_job.request_id = p_request_id;
    if provider_cost is null then return null; end if;
    return public.quote_retail_credits_from_upstream_points(provider_cost::numeric * 0.15 * 7.3 * 10);
  end if;

  if normalized_provider in ('hunyuan3d', 'hyper3d', 'tripo3d') then
    select tool_job.provider_cost into provider_cost
    from public.ai_tool_jobs tool_job
    where tool_job.request_id = p_request_id;
    -- Older rows did not persist option-derived cost. Use the highest current
    -- selectable tier for those records so reporting cannot become a loss.
    provider_cost := coalesce(provider_cost, case normalized_provider
      when 'hunyuan3d' then 80 when 'hyper3d' then 70 else 60 end);
    return public.quote_retail_credits_from_upstream_points(provider_cost::numeric / 100 * 7.3 * 10);
  end if;

  if normalized_provider in (
    'background-remove', 'clipdrop-uncrop', 'kling-image-expand', 'cleanup',
    'clipdrop-upscale', 'generative-upscale', 'seededit-v3',
    'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase'
  ) then
    upstream_points := case normalized_provider
      when 'background-remove' then 0.50 * 7.3 * 10
      when 'clipdrop-uncrop' then 0.50 * 7.3 * 10
      when 'kling-image-expand' then 0.50 * 7.3 * 10
      when 'cleanup' then 0.50 * 7.3 * 10
      when 'clipdrop-upscale' then 0.50 * 7.3 * 10
      when 'generative-upscale' then 0.80 * 7.3 * 10
      when 'seededit-v3' then 0.05 * 7.3 * 10
      when 'qwen-image-edit-plus' then 0.10 * 7.3 * 10
      when 'qwen-image-layered' then 0.05 * 7.3 * 10
      when 'super-upscale-v2' then 0.10 * 7.3 * 10
      when 'erase' then 0.50 * 7.3 * 10
    end;
    return public.quote_retail_credits_from_upstream_points(upstream_points);
  end if;

  if normalized_kind = 'image' then
    if normalized_provider in ('image-6', 'atlas-image-gpt2', 'atlas-image-gpt2-edit') then
      normalized_quality := split_part(normalized_resolution || ':1k', ':', 1);
      image_resolution := split_part(normalized_resolution || ':1k', ':', 2);
      if normalized_quality not in ('low', 'medium', 'high', 'auto') then normalized_quality := 'auto'; end if;
      if image_resolution not in ('1k', '2k', '4k') then image_resolution := '1k'; end if;
      upstream_points := case
        when normalized_provider = 'atlas-image-gpt2' then case normalized_quality
          when 'low' then case image_resolution when '1k' then 1 else 2 end
          when 'high' then case image_resolution when '1k' then 16 else 32 end
          else case image_resolution when '1k' then 5 else 9 end
        end
        else case normalized_quality
          when 'low' then case image_resolution when '1k' then 2 else 3 end
          when 'high' then case image_resolution when '1k' then 17 else 33 end
          else case image_resolution when '1k' then 6 else 10 end
        end
      end;
      return public.quote_retail_credits_from_upstream_points(upstream_points);
    end if;

    if normalized_provider = 'image-3' then
      return case when normalized_resolution = '4k' then 8 else 5 end;
    end if;

    upstream_points := case normalized_provider
      when 'image-1' then case normalized_resolution
        when '1k' then 0.14 * 7.3 * 10
        when '4k' then 0.48 * 7.3 * 10
        else 0.24 * 7.3 * 10 end
      when 'image-2' then case normalized_resolution when '1k' then 4 when '4k' then 8 else 6 end
      when 'image-4' then 2
      when 'image-5' then 2
      when 'image-7' then case normalized_resolution when '1080p' then 4 else 2 end
      when 'image-8' then case normalized_resolution when '1080p' then 4 else 2 end
      when 'image-9' then 3
      when 'image-10' then case normalized_resolution when '4k' then 7 else 4 end
      when 'image-11' then case normalized_resolution when '4k' then 4 else 3 end
      when 'image-12' then case normalized_resolution when '2k' then 3 when '4k' then 4 else 2 end
      when 'image-13' then 2
      when 'image-14' then 2
      when 'image-15' then case normalized_resolution when '2k' then 4 else 3 end
      when 'image-16' then 2
      when 'image-17' then case normalized_resolution when '2k' then 0.32 * 7.3 * 10 else 0.08 * 7.3 * 10 end
      when 'image-18' then case normalized_resolution when '2k' then 0.32 * 7.3 * 10 else 0.08 * 7.3 * 10 end
      else null
    end;
    if upstream_points is null then return null; end if;
    return public.quote_retail_credits_from_upstream_points(upstream_points);
  end if;

  if normalized_kind <> 'video' then return null; end if;

  if normalized_provider = 'video-1' then
    select * into video_job
    from public.ai_video_jobs
    where request_id = p_request_id;
    normalized_resolution := lower(coalesce(nullif(video_job.resolution, ''), p_resolution, '768p'));
    billable_seconds := case
      when video_job.provider_output_seconds is not null or video_job.provider_input_seconds is not null
        then coalesce(video_job.provider_output_seconds, video_job.duration_seconds, normalized_duration)
          + coalesce(video_job.provider_input_seconds, 0)
      when video_job.provider_total_seconds is not null then video_job.provider_total_seconds
      else coalesce(video_job.duration_seconds, normalized_duration) end;
    input_image_count := greatest(0, coalesce(video_job.provider_input_image_count, 0));
    upstream_cny := (case when upper(normalized_resolution) = '2K' then 0.80 else 0.50 end)
      * greatest(0, billable_seconds) + 0.20 * greatest(0, input_image_count - 5);
    return ceil(upstream_cny * (1000.0 / 70.0) * 1.10 / 0.80)::integer;
  end if;

  if normalized_provider in ('video-2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref') then
    return public.quote_seedance_retail_credits('video-2', upper(normalized_resolution), normalized_duration);
  end if;
  if normalized_provider in ('video-3', 'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref') then
    return public.quote_seedance_retail_credits('video-3', upper(normalized_resolution), normalized_duration);
  end if;
  if normalized_provider = 'video-4' then
    return public.quote_seedance_retail_credits('video-4', upper(normalized_resolution), normalized_duration);
  end if;

  normalized_duration := case normalized_provider
    when 'video-5' then greatest(2, least(12, normalized_duration))
    when 'video-6' then greatest(2, least(12, normalized_duration))
    when 'video-7' then greatest(2, least(12, normalized_duration))
    when 'video-8' then greatest(5, least(10, normalized_duration))
    when 'video-9' then greatest(5, least(10, normalized_duration))
    when 'video-10' then greatest(3, least(15, normalized_duration))
    when 'video-11' then greatest(3, least(15, normalized_duration))
    when 'video-12' then greatest(3, least(15, normalized_duration))
    when 'video-13' then greatest(3, least(15, normalized_duration))
    else null end;
  if normalized_duration is null then return null; end if;

  upstream_points := case normalized_provider
    when 'video-5' then (case when upper(normalized_resolution) = '480P' then 2 else 3 end) * normalized_duration
    when 'video-6' then (case upper(normalized_resolution) when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration
    when 'video-7' then (case when upper(normalized_resolution) = '480P' then 1.5 else 2.5 end) * normalized_duration
    when 'video-8' then (case when upper(normalized_resolution) = '1080P' then 1 else 0.5 end) * normalized_duration
    when 'video-9' then 2 * normalized_duration
    when 'video-10' then 18.4 * normalized_duration
    when 'video-11' then 24.6 * normalized_duration
    when 'video-12' then 21.9 * normalized_duration
    when 'video-13' then 26.3 * normalized_duration
  end;
  return public.quote_video_retail_credits_from_upstream_points(upstream_points);
end;
$$;

create or replace function public.get_canvas_ai_usage_summary(
  p_user_id uuid,
  p_canvas_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_canvas text := trim(coalesce(p_canvas_id, ''));
  result jsonb;
begin
  if p_user_id is null
     or normalized_canvas !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'A valid canvas id is required.' using errcode = '22023';
  end if;

  with filtered as (
    select
      usage_row.request_id,
      case when usage_row.provider_id in ('hunyuan3d', 'hyper3d', 'tripo3d')
        then '3d' else usage_row.kind end as usage_kind,
      coalesce(nullif(trim(usage_row.provider_id), ''), 'unknown') as provider_id,
      greatest(0, coalesce(usage_row.credits_charged, 0))::integer as historical_credits_charged,
      greatest(0, coalesce(usage_row.credits_reserved, 0), coalesce(
        public.current_policy_ai_usage_credits(usage_row.request_id, usage_row.kind, usage_row.provider_id, usage_row.resolution, usage_row.duration_seconds), 0
      ))::integer as estimated_credits,
      case when usage_row.status = 'succeeded' then greatest(
        0, coalesce(usage_row.credits_charged, 0), coalesce(
          public.current_policy_ai_usage_credits(usage_row.request_id, usage_row.kind, usage_row.provider_id, usage_row.resolution, usage_row.duration_seconds), 0
        )
      )::integer else null end as credits_charged,
      usage_row.status,
      usage_row.resolution,
      usage_row.duration_seconds,
      usage_row.created_at
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id
      and usage_row.canvas_id = normalized_canvas
      and usage_row.status in ('reserved', 'succeeded')
  )
  select jsonb_build_object(
    'canvasId', normalized_canvas,
    'totals', jsonb_build_object(
      'estimatedCredits', coalesce(sum(filtered.estimated_credits), 0)::bigint,
      'creditsCharged', coalesce(sum(filtered.credits_charged), 0)::bigint,
      'credits', coalesce(sum(case when filtered.status = 'succeeded' then filtered.credits_charged else filtered.estimated_credits end), 0)::bigint,
      'generations', count(*)::bigint,
      'pending', count(*) filter (where filtered.status = 'reserved')::bigint
    ),
    'details', coalesce(jsonb_agg(jsonb_build_object(
      'requestId', filtered.request_id,
      'kind', filtered.usage_kind,
      'providerId', filtered.provider_id,
      'estimatedCredits', filtered.estimated_credits,
      'creditsReserved', filtered.estimated_credits,
      'historicalCreditsCharged', case when filtered.status = 'succeeded' then filtered.historical_credits_charged else null end,
      'creditsCharged', filtered.credits_charged,
      'credits', filtered.credits_charged,
      'status', filtered.status,
      'resolution', filtered.resolution,
      'duration', filtered.duration_seconds,
      'createdAt', to_char(filtered.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by filtered.created_at desc) filter (where filtered.request_id is not null), '[]'::jsonb)
  ) into result from filtered;
  return result;
end;
$$;

create or replace function public.get_ai_usage_summary_between(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_tz_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_offset integer := greatest(-840, least(840, coalesce(p_tz_offset, 0)));
  local_today date := ((now() at time zone 'UTC') + make_interval(mins => normalized_offset))::date;
  period_start date := p_from;
  period_end date := least(p_to, local_today);
  period_days integer;
  account_record public.ai_credit_accounts%rowtype;
  result jsonb;
begin
  if p_user_id is null or period_start is null or p_to is null
     or period_start > period_end or period_end - period_start > 3660 then
    raise exception 'The usage date range is invalid.' using errcode = '22023';
  end if;
  period_days := period_end - period_start + 1;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id;

  with filtered as (
    select
      case when usage_row.provider_id in ('hunyuan3d', 'hyper3d', 'tripo3d') then '3d' else usage_row.kind end as kind,
      coalesce(nullif(trim(usage_row.provider_id), ''), 'unknown') as provider_id,
      greatest(0, coalesce(usage_row.credits_charged, 0), coalesce(
        public.current_policy_ai_usage_credits(usage_row.request_id, usage_row.kind, usage_row.provider_id, usage_row.resolution, usage_row.duration_seconds), 0
      ))::integer as credits,
      ((usage_row.created_at at time zone 'UTC') + make_interval(mins => normalized_offset))::date as usage_date
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id and usage_row.status = 'succeeded'
      and ((usage_row.created_at at time zone 'UTC') + make_interval(mins => normalized_offset))::date between period_start and period_end
  ), totals as (
    select coalesce(sum(credits), 0)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations, count(*)::bigint as requests from filtered
  ), type_names as (
    select unnest(array['image', 'video', '3d', 'chat']::text[]) as kind
  ), type_rows as (
    select type_names.kind, coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from type_names left join filtered on filtered.kind = type_names.kind group by type_names.kind
  ), daily_rows as (
    select day_value::date as usage_date, coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from generate_series(period_start, period_end, interval '1 day') as day_value
    left join filtered on filtered.usage_date = day_value::date group by day_value::date
  ), model_rows as (
    select provider_id, kind, sum(credits)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations, count(*)::bigint as requests
    from filtered group by provider_id, kind
  )
  select jsonb_build_object(
    'range', 'custom', 'timeZoneOffset', normalized_offset,
    'period', jsonb_build_object('from', to_char(period_start, 'YYYY-MM-DD'), 'to', to_char(period_end, 'YYYY-MM-DD'), 'days', period_days),
    'account', jsonb_build_object('balance', coalesce(account_record.balance, 0), 'reserved', coalesce(account_record.reserved, 0),
      'availableCredits', greatest(0, coalesce(account_record.balance, 0) - coalesce(account_record.reserved, 0)),
      'membershipTier', coalesce(account_record.membership_tier, 'free')),
    'totals', jsonb_build_object('credits', totals.credits, 'generations', totals.generations, 'requests', totals.requests,
      'averagePerDay', round(totals.credits::numeric / period_days, 2)),
    'byType', coalesce((select jsonb_agg(jsonb_build_object('kind', type_rows.kind, 'credits', type_rows.credits,
      'generations', type_rows.generations, 'requests', type_rows.requests) order by array_position(array['image', 'video', '3d', 'chat']::text[], type_rows.kind)) from type_rows), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', to_char(daily_rows.usage_date, 'YYYY-MM-DD'), 'credits', daily_rows.credits,
      'generations', daily_rows.generations, 'requests', daily_rows.requests) order by daily_rows.usage_date) from daily_rows), '[]'::jsonb),
    'byModel', coalesce((select jsonb_agg(model_item.payload order by model_item.credits desc, model_item.requests desc, model_item.provider_id)
      from (select model_rows.provider_id, model_rows.credits, model_rows.requests, jsonb_build_object('providerId', model_rows.provider_id,
        'kind', model_rows.kind, 'credits', model_rows.credits, 'generations', model_rows.generations, 'requests', model_rows.requests) as payload
        from model_rows order by model_rows.credits desc, model_rows.requests desc, model_rows.provider_id limit 20) model_item), '[]'::jsonb),
    'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into result from totals;
  return result;
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
  if p_user_id is null then raise exception 'A user id is required.' using errcode = '22023'; end if;
  normalized_range := case normalized_range when '7' then '7d' when '7d' then '7d' when '30' then '30d' when '30d' then '30d' when 'all' then 'all' else null end;
  if normalized_range is null then raise exception 'The usage range is invalid.' using errcode = '22023'; end if;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id;
  if normalized_range = '7d' then period_start := today_utc - 6;
  elsif normalized_range = '30d' then period_start := today_utc - 29;
  else
    select least(coalesce((account_record.created_at at time zone 'UTC')::date, today_utc),
      coalesce(min((usage_row.created_at at time zone 'UTC')::date), today_utc)) into period_start
    from public.ai_usage usage_row where usage_row.user_id = p_user_id and usage_row.status = 'succeeded';
  end if;
  period_start := least(coalesce(period_start, today_utc), today_utc);
  period_days := greatest(1, today_utc - period_start + 1);

  with filtered as (
    select
      case when usage_row.provider_id in ('hunyuan3d', 'hyper3d', 'tripo3d') then '3d' else usage_row.kind end as kind,
      coalesce(nullif(trim(usage_row.provider_id), ''), 'unknown') as provider_id,
      greatest(0, coalesce(usage_row.credits_charged, 0), coalesce(
        public.current_policy_ai_usage_credits(usage_row.request_id, usage_row.kind, usage_row.provider_id, usage_row.resolution, usage_row.duration_seconds), 0
      ))::integer as credits,
      (usage_row.created_at at time zone 'UTC')::date as usage_date
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id and usage_row.status = 'succeeded'
      and (usage_row.created_at at time zone 'UTC')::date between period_start and today_utc
  ), totals as (
    select coalesce(sum(credits), 0)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations, count(*)::bigint as requests from filtered
  ), type_names as (
    select unnest(array['image', 'video', '3d', 'chat']::text[]) as kind
  ), type_rows as (
    select type_names.kind, coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from type_names left join filtered on filtered.kind = type_names.kind group by type_names.kind
  ), daily_rows as (
    select day_value::date as usage_date, coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from generate_series(period_start, today_utc, interval '1 day') as day_value
    left join filtered on filtered.usage_date = day_value::date group by day_value::date
  ), model_rows as (
    select provider_id, kind, sum(credits)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations, count(*)::bigint as requests
    from filtered group by provider_id, kind
  )
  select jsonb_build_object(
    'range', normalized_range, 'timeZone', 'UTC',
    'period', jsonb_build_object('from', to_char(period_start, 'YYYY-MM-DD'), 'to', to_char(today_utc, 'YYYY-MM-DD'), 'days', period_days),
    'account', jsonb_build_object('balance', coalesce(account_record.balance, 0), 'reserved', coalesce(account_record.reserved, 0),
      'availableCredits', greatest(0, coalesce(account_record.balance, 0) - coalesce(account_record.reserved, 0)),
      'membershipTier', coalesce(account_record.membership_tier, 'free')),
    'totals', jsonb_build_object('credits', totals.credits, 'generations', totals.generations, 'requests', totals.requests,
      'averagePerDay', round(totals.credits::numeric / period_days, 2)),
    'byType', coalesce((select jsonb_agg(jsonb_build_object('kind', type_rows.kind, 'credits', type_rows.credits,
      'generations', type_rows.generations, 'requests', type_rows.requests) order by array_position(array['image', 'video', '3d', 'chat']::text[], type_rows.kind)) from type_rows), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', to_char(daily_rows.usage_date, 'YYYY-MM-DD'), 'credits', daily_rows.credits,
      'generations', daily_rows.generations, 'requests', daily_rows.requests) order by daily_rows.usage_date) from daily_rows), '[]'::jsonb),
    'byModel', coalesce((select jsonb_agg(model_item.payload order by model_item.credits desc, model_item.requests desc, model_item.provider_id)
      from (select model_rows.provider_id, model_rows.credits, model_rows.requests, jsonb_build_object('providerId', model_rows.provider_id,
        'kind', model_rows.kind, 'credits', model_rows.credits, 'generations', model_rows.generations, 'requests', model_rows.requests) as payload
        from model_rows order by model_rows.credits desc, model_rows.requests desc, model_rows.provider_id limit 20) model_item), '[]'::jsonb),
    'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into result from totals;
  return result;
end;
$$;

revoke all on function public.current_policy_ai_usage_credits(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.current_policy_ai_usage_credits(uuid, text, text, text, integer) to service_role;
revoke all on function public.get_canvas_ai_usage_summary(uuid, text) from public, anon, authenticated;
grant execute on function public.get_canvas_ai_usage_summary(uuid, text) to service_role;
revoke all on function public.get_ai_usage_summary_between(uuid, date, date, integer) from public, anon, authenticated;
grant execute on function public.get_ai_usage_summary_between(uuid, date, date, integer) to service_role;
revoke all on function public.get_ai_usage_summary(uuid, text) from public, anon, authenticated;
grant execute on function public.get_ai_usage_summary(uuid, text) to service_role;

notify pgrst, 'reload schema';
