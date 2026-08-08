-- Server-side usage aggregation for the authenticated account. The function
-- returns retail Messs credits only; provider costs and ledger metadata never
-- cross the gateway boundary.

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

  select * into account_record
  from public.ai_credit_accounts
  where user_id = p_user_id;

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
    where usage_row.user_id = p_user_id
      and usage_row.status = 'succeeded';
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
    select unnest(array['chat', 'image', 'video']::text[]) as kind
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
      ) order by array_position(array['image', 'video', 'chat']::text[], type_rows.kind))
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

revoke all on function public.get_ai_usage_summary(uuid, text) from public, anon, authenticated;
grant execute on function public.get_ai_usage_summary(uuid, text) to service_role;
