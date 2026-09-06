-- Keep usage reporting aligned with the points ledger.
--
-- The previous reporting migration deliberately used the higher of the saved
-- debit and the current quote. That protected margin, but it also made usage
-- totals claim that more points were charged than the account actually lost.
-- Estimates remain available on each row; settled totals must use the
-- immutable ai_usage.credits_charged value only.

alter function public.get_canvas_ai_usage_summary(uuid, text)
  rename to get_canvas_ai_usage_summary_legacy_repriced;
alter function public.get_ai_usage_summary_between(uuid, date, date, integer)
  rename to get_ai_usage_summary_between_legacy_repriced;
alter function public.get_ai_usage_summary(uuid, text)
  rename to get_ai_usage_summary_legacy_repriced;

create or replace function public.authoritative_ai_usage_summary(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_range text,
  p_tz_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_offset integer := greatest(-840, least(840, coalesce(p_tz_offset, 0)));
  period_days integer;
  account_record public.ai_credit_accounts%rowtype;
  result jsonb;
begin
  if p_user_id is null or p_from is null or p_to is null
     or p_from > p_to or p_to - p_from > 3660 then
    raise exception 'The usage date range is invalid.' using errcode = '22023';
  end if;
  period_days := p_to - p_from + 1;
  select * into account_record
  from public.ai_credit_accounts
  where user_id = p_user_id;

  with filtered as (
    select
      case when usage_row.provider_id in ('hunyuan3d', 'hyper3d', 'tripo3d')
        then '3d' else usage_row.kind end as kind,
      coalesce(nullif(trim(usage_row.provider_id), ''), 'unknown') as provider_id,
      greatest(0, coalesce(usage_row.credits_charged, 0))::bigint as credits,
      ((usage_row.created_at at time zone 'UTC')
        + make_interval(mins => normalized_offset))::date as usage_date
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id
      and usage_row.status = 'succeeded'
      and ((usage_row.created_at at time zone 'UTC')
        + make_interval(mins => normalized_offset))::date between p_from and p_to
  ), totals as (
    select coalesce(sum(credits), 0)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations,
      count(*)::bigint as requests
    from filtered
  ), type_names as (
    select unnest(array['image', 'video', '3d', 'chat']::text[]) as kind
  ), type_rows as (
    select type_names.kind,
      coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from type_names
    left join filtered on filtered.kind = type_names.kind
    group by type_names.kind
  ), daily_rows as (
    select day_value::date as usage_date,
      coalesce(sum(filtered.credits), 0)::bigint as credits,
      count(filtered.kind) filter (where filtered.kind <> 'chat')::bigint as generations,
      count(filtered.kind)::bigint as requests
    from generate_series(p_from, p_to, interval '1 day') as day_value
    left join filtered on filtered.usage_date = day_value::date
    group by day_value::date
  ), model_rows as (
    select provider_id, kind, sum(credits)::bigint as credits,
      count(*) filter (where kind <> 'chat')::bigint as generations,
      count(*)::bigint as requests
    from filtered
    group by provider_id, kind
  )
  select jsonb_build_object(
    'range', coalesce(nullif(p_range, ''), 'custom'),
    'timeZone', case when p_range = 'custom' then null else 'UTC' end,
    'timeZoneOffset', case when p_range = 'custom' then normalized_offset else null end,
    'period', jsonb_build_object(
      'from', to_char(p_from, 'YYYY-MM-DD'),
      'to', to_char(p_to, 'YYYY-MM-DD'),
      'days', period_days
    ),
    'account', jsonb_build_object(
      'balance', coalesce(account_record.balance, 0),
      'reserved', coalesce(account_record.reserved, 0),
      'availableCredits', greatest(0, coalesce(account_record.balance, 0)
        - coalesce(account_record.reserved, 0)),
      'membershipTier', coalesce(account_record.membership_tier, 'free')
    ),
    'totals', jsonb_build_object(
      'credits', totals.credits,
      'generations', totals.generations,
      'requests', totals.requests,
      'averagePerDay', round(totals.credits::numeric / period_days, 2)
    ),
    'byType', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', type_rows.kind, 'credits', type_rows.credits,
      'generations', type_rows.generations, 'requests', type_rows.requests
    ) order by array_position(array['image', 'video', '3d', 'chat']::text[], type_rows.kind))
      from type_rows), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'date', to_char(daily_rows.usage_date, 'YYYY-MM-DD'),
      'credits', daily_rows.credits,
      'generations', daily_rows.generations,
      'requests', daily_rows.requests
    ) order by daily_rows.usage_date) from daily_rows), '[]'::jsonb),
    'byModel', coalesce((select jsonb_agg(model_item.payload order by
      model_item.credits desc, model_item.requests desc, model_item.provider_id)
      from (
        select model_rows.provider_id, model_rows.credits, model_rows.requests,
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
      ) model_item), '[]'::jsonb),
    'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into result
  from totals;
  return result;
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
  legacy jsonb;
  normalized_details jsonb;
  settled_total bigint;
begin
  if p_user_id is null or trim(coalesce(p_canvas_id, '')) !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'A valid canvas id is required.' using errcode = '22023';
  end if;
  legacy := public.get_canvas_ai_usage_summary_legacy_repriced(p_user_id, trim(p_canvas_id));

  with source_rows as (
    select value as item, ordinality
    from jsonb_array_elements(coalesce(legacy->'details', '[]'::jsonb)) with ordinality
  ), normalized as (
    select item || jsonb_build_object(
      'creditsCharged', case when item->>'status' = 'succeeded' then greatest(
        0,
        coalesce(nullif(item->>'historicalCreditsCharged', '')::bigint,
          nullif(item->>'creditsCharged', '')::bigint, 0)
      ) else null end,
      'credits', case when item->>'status' = 'succeeded' then greatest(
        0,
        coalesce(nullif(item->>'historicalCreditsCharged', '')::bigint,
          nullif(item->>'creditsCharged', '')::bigint, 0)
      ) else 0 end
    ) as item, ordinality
    from source_rows
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb),
    coalesce(sum(case when item->>'status' = 'succeeded' then greatest(
      0,
      coalesce(nullif(item->>'historicalCreditsCharged', '')::bigint,
        nullif(item->>'creditsCharged', '')::bigint, 0)
    ) else 0 end), 0)::bigint
  into normalized_details, settled_total
  from normalized;

  return legacy || jsonb_build_object(
    'totals', coalesce(legacy->'totals', '{}'::jsonb) || jsonb_build_object(
      'creditsCharged', settled_total,
      'credits', settled_total
    ),
    'details', normalized_details
  );
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
begin
  return public.authoritative_ai_usage_summary(p_user_id, p_from, p_to, 'custom', p_tz_offset);
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
  account_created date;
begin
  if p_user_id is null then
    raise exception 'A user id is required.' using errcode = '22023';
  end if;
  normalized_range := case normalized_range
    when '7' then '7d' when '7d' then '7d'
    when '30' then '30d' when '30d' then '30d'
    when 'all' then 'all' else null end;
  if normalized_range is null then
    raise exception 'The usage range is invalid.' using errcode = '22023';
  end if;
  select (created_at at time zone 'UTC')::date into account_created
  from public.ai_credit_accounts where user_id = p_user_id;
  if normalized_range = '7d' then
    period_start := today_utc - 6;
  elsif normalized_range = '30d' then
    period_start := today_utc - 29;
  else
    select least(coalesce(account_created, today_utc), coalesce(min(
      (usage_row.created_at at time zone 'UTC')::date
    ), today_utc)) into period_start
    from public.ai_usage usage_row
    where usage_row.user_id = p_user_id and usage_row.status = 'succeeded';
  end if;
  period_start := least(coalesce(period_start, today_utc), today_utc);
  return public.authoritative_ai_usage_summary(
    p_user_id, period_start, today_utc, normalized_range, 0
  );
end;
$$;

revoke all on function public.authoritative_ai_usage_summary(uuid, date, date, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_canvas_ai_usage_summary(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_ai_usage_summary_between(uuid, date, date, integer)
  from public, anon, authenticated;
revoke all on function public.get_ai_usage_summary(uuid, text)
  from public, anon, authenticated;
grant execute on function public.authoritative_ai_usage_summary(uuid, date, date, text, integer)
  to service_role;
grant execute on function public.get_canvas_ai_usage_summary(uuid, text)
  to service_role;
grant execute on function public.get_ai_usage_summary_between(uuid, date, date, integer)
  to service_role;
grant execute on function public.get_ai_usage_summary(uuid, text)
  to service_role;

-- Preserve the legacy functions only as private migration helpers. They are
-- never callable by clients and can be removed in a future cleanup migration.
revoke all on function public.get_canvas_ai_usage_summary_legacy_repriced(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_ai_usage_summary_between_legacy_repriced(uuid, date, date, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_ai_usage_summary_legacy_repriced(uuid, text)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
;
