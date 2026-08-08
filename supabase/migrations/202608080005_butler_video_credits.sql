-- Provider-cost accounting for asynchronous Butler video enhancement. Topaz
-- returns provider points at 0.15 PTC each. Messs prices these at 10 app
-- credits/CNY with a 2x retail multiplier, so retail credits are ceil(cost * 3).

create table if not exists public.ai_tool_jobs (
  request_id uuid primary key references public.ai_usage(request_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null check (provider_id = 'topaz-video-upscale'),
  provider_cost integer not null check (provider_cost between 0 and 1000000),
  retail_credits integer not null check (retail_credits between 0 and 3000000),
  status text not null default 'processing'
    check (status in ('processing', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (status = 'processing' and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

alter table public.ai_tool_jobs add column if not exists provider_cost integer;
alter table public.ai_tool_jobs add column if not exists retail_credits integer;

create index if not exists ai_tool_jobs_user_created_idx
  on public.ai_tool_jobs (user_id, created_at desc);

alter table public.ai_tool_jobs enable row level security;
revoke all on table public.ai_tool_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_tool_jobs to service_role;

drop function if exists public.reserve_ai_tool_credits(uuid, uuid, text, integer, text, integer);

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
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
  job_record public.ai_tool_jobs%rowtype;
  expected_credits integer := ceil(coalesce(p_provider_cost, -1)::numeric * 0.15 * 10 * 2)::integer;
begin
  if normalized_provider <> 'topaz-video-upscale'
     or p_provider_cost is null or p_provider_cost < 0 or p_provider_cost > 1000000
     or p_credits is null or p_credits <> expected_credits or p_credits > 3000000 then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id;
  if quota_record.suspended then
    return jsonb_build_object('ok', false, 'reason', 'account-suspended');
  end if;

  select * into usage_record from public.ai_usage where request_id = p_request_id for update;
  if found then
    select * into job_record from public.ai_tool_jobs where request_id = p_request_id;
    if usage_record.user_id <> p_user_id
       or usage_record.kind <> 'video'
       or coalesce(usage_record.provider_id, '') <> normalized_provider
       or usage_record.credits_reserved <> p_credits
       or not found
       or job_record.provider_cost <> p_provider_cost
       or job_record.retail_credits <> p_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', usage_record.status = 'reserved',
      'reason', case when usage_record.status = 'reserved' then 'already-reserved' else 'request-id-conflict' end,
      'credits', p_credits,
      'providerCost', p_provider_cost,
      'balance', account_record.balance,
      'reserved', account_record.reserved,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  if account_record.balance - account_record.reserved < p_credits then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient-credits',
      'credits', p_credits,
      'providerCost', p_provider_cost,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, 'video', normalized_provider,
     normalized_resolution, normalized_duration, p_credits);

  insert into public.ai_tool_jobs
    (request_id, user_id, provider_id, provider_cost, retail_credits)
  values
    (p_request_id, p_user_id, normalized_provider, p_provider_cost, p_credits);

  if p_credits > 0 then
    update public.ai_credit_accounts
    set reserved = reserved + p_credits, updated_at = now()
    where user_id = p_user_id returning * into account_record;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'reserve', 0, p_credits, account_record.balance, account_record.reserved,
       p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
       jsonb_build_object('kind', 'video', 'providerId', normalized_provider,
                          'providerCost', p_provider_cost, 'retailCredits', p_credits,
                          'resolution', normalized_resolution, 'duration', normalized_duration))
    on conflict (user_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'reserved',
    'credits', p_credits,
    'providerCost', p_provider_cost,
    'balance', account_record.balance,
    'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved
  );
end;
$$;

create or replace function public.touch_ai_tool_credits(
  p_request_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare job public.ai_tool_jobs%rowtype;
begin
  select * into job from public.ai_tool_jobs
  where request_id = p_request_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if job.status <> 'processing' then
    return jsonb_build_object('ok', true, 'reason', 'already-settled', 'status', job.status);
  end if;
  update public.ai_tool_jobs set updated_at = now() where request_id = p_request_id;
  update public.ai_usage
  set created_at = now()
  where request_id = p_request_id and user_id = p_user_id and status = 'reserved';
  return jsonb_build_object('ok', true, 'reason', 'touched', 'status', job.status);
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

revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.touch_ai_tool_credits(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.settle_ai_tool_credits(uuid, uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;
grant execute on function public.touch_ai_tool_credits(uuid, uuid)
  to service_role;
grant execute on function public.settle_ai_tool_credits(uuid, uuid, text, integer)
  to service_role;
