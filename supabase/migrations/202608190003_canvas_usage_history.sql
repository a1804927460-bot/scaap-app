-- Durable canvas attribution and calendar-range usage reporting.
-- A canvas id is accounting metadata only; it never affects the charge.

alter table public.ai_usage add column if not exists canvas_id text;

do $$
begin
  alter table public.ai_usage
    add constraint ai_usage_canvas_id_length
    check (canvas_id is null or char_length(canvas_id) between 1 and 120);
exception when duplicate_object then null;
end;
$$;

create index if not exists ai_usage_user_canvas_created_idx
  on public.ai_usage (user_id, canvas_id, created_at desc)
  where canvas_id is not null;

create or replace function public.set_ai_usage_canvas(
  p_user_id uuid,
  p_request_id uuid,
  p_canvas_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_canvas text := trim(coalesce(p_canvas_id, ''));
begin
  if p_user_id is null or p_request_id is null
     or normalized_canvas !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    return false;
  end if;
  update public.ai_usage
  set canvas_id = normalized_canvas
  where request_id = p_request_id
    and user_id = p_user_id
    and (canvas_id is null or canvas_id = normalized_canvas);
  return found;
end;
$$;

revoke all on function public.set_ai_usage_canvas(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_ai_usage_canvas(uuid, uuid, text)
  to service_role;

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
      greatest(0, coalesce(usage_row.credits_charged, 0))::integer as credits,
      usage_row.resolution,
      usage_row.duration_seconds,
      usage_row.created_at
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id
      and usage_row.canvas_id = normalized_canvas
      and usage_row.status = 'succeeded'
  )
  select jsonb_build_object(
    'canvasId', normalized_canvas,
    'totals', jsonb_build_object(
      'credits', coalesce(sum(filtered.credits), 0)::bigint,
      'generations', count(*)::bigint
    ),
    'details', coalesce(jsonb_agg(jsonb_build_object(
      'requestId', filtered.request_id,
      'kind', filtered.usage_kind,
      'providerId', filtered.provider_id,
      'credits', filtered.credits,
      'resolution', filtered.resolution,
      'duration', filtered.duration_seconds,
      'createdAt', to_char(filtered.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by filtered.created_at desc) filter (where filtered.request_id is not null), '[]'::jsonb)
  )
  into result
  from filtered;

  return result;
end;
$$;

revoke all on function public.get_canvas_ai_usage_summary(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_canvas_ai_usage_summary(uuid, text)
  to service_role;

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

  select * into account_record
  from public.ai_credit_accounts
  where user_id = p_user_id;

  with filtered as (
    select
      case when usage_row.provider_id in ('hunyuan3d', 'hyper3d', 'tripo3d')
        then '3d' else usage_row.kind end as kind,
      coalesce(nullif(trim(usage_row.provider_id), ''), 'unknown') as provider_id,
      greatest(0, coalesce(usage_row.credits_charged, 0))::integer as credits,
      ((usage_row.created_at at time zone 'UTC') + make_interval(mins => normalized_offset))::date as usage_date
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id
      and usage_row.status = 'succeeded'
      and ((usage_row.created_at at time zone 'UTC') + make_interval(mins => normalized_offset))::date
        between period_start and period_end
  ),
  totals as (
    select
      coalesce(sum(credits), 0)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations,
      count(*)::bigint as requests
    from filtered
  ),
  type_names as (
    select unnest(array['image', 'video', '3d', 'chat']::text[]) as kind
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
    from generate_series(period_start, period_end, interval '1 day') as day_value
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
    'range', 'custom',
    'timeZoneOffset', normalized_offset,
    'period', jsonb_build_object(
      'from', to_char(period_start, 'YYYY-MM-DD'),
      'to', to_char(period_end, 'YYYY-MM-DD'),
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
    'byType', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', type_rows.kind,
      'credits', type_rows.credits,
      'generations', type_rows.generations,
      'requests', type_rows.requests
    ) order by array_position(array['image', 'video', '3d', 'chat']::text[], type_rows.kind)) from type_rows), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'date', to_char(daily_rows.usage_date, 'YYYY-MM-DD'),
      'credits', daily_rows.credits,
      'generations', daily_rows.generations,
      'requests', daily_rows.requests
    ) order by daily_rows.usage_date) from daily_rows), '[]'::jsonb),
    'byModel', coalesce((select jsonb_agg(model_item.payload order by model_item.credits desc, model_item.requests desc, model_item.provider_id)
      from (select model_rows.provider_id, model_rows.credits, model_rows.requests,
        jsonb_build_object(
          'providerId', model_rows.provider_id,
          'kind', model_rows.kind,
          'credits', model_rows.credits,
          'generations', model_rows.generations,
          'requests', model_rows.requests
        ) as payload
        from model_rows
        order by model_rows.credits desc, model_rows.requests desc, model_rows.provider_id
        limit 20) model_item), '[]'::jsonb),
    'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  into result
  from totals;

  return result;
end;
$$;

revoke all on function public.get_ai_usage_summary_between(uuid, date, date, integer)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_summary_between(uuid, date, date, integer)
  to service_role;

notify pgrst, 'reload schema';
