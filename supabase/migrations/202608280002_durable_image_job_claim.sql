-- Make image submission ownership durable before contacting a billable route.
-- A retry can therefore resume the same task instead of submitting twice.

alter table public.ai_image_jobs
  drop constraint if exists ai_image_jobs_status_check;

alter table public.ai_image_jobs
  add constraint ai_image_jobs_status_check
  check (status in ('starting', 'submitted', 'ready', 'failed'));

create or replace function public.claim_ai_image_job(
  p_user_id uuid,
  p_request_id uuid,
  p_request_hash text,
  p_provider_id text,
  p_deadline_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_record public.ai_usage%rowtype;
  existing public.ai_image_jobs%rowtype;
  claimed public.ai_image_jobs%rowtype;
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
begin
  if p_user_id is null or p_request_id is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{32,128}$'
     or normalized_provider !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-request');
  end if;

  select * into usage_record
  from public.ai_usage
  where request_id = p_request_id and user_id = p_user_id and kind = 'image'
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'usage-not-found'); end if;

  select * into existing from public.ai_image_jobs
  where request_id = p_request_id for update;
  if found then
    if existing.user_id <> p_user_id or existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'reason', 'already-started',
      'requestId', existing.request_id, 'userId', existing.user_id,
      'requestHash', existing.request_hash, 'providerId', existing.provider_id,
      'providerTaskId', existing.provider_task_id, 'pollUrl', existing.poll_url,
      'resultUrl', existing.result_url, 'status', existing.status,
      'creditsReserved', existing.credits_reserved, 'deadlineAt', existing.deadline_at,
      'errorCode', existing.error_code, 'errorMessage', existing.error_message
    );
  end if;

  if usage_record.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'reason', 'usage-not-reserved');
  end if;

  insert into public.ai_image_jobs (
    request_id, user_id, request_hash, provider_id, provider_task_id,
    status, credits_reserved, deadline_at
  ) values (
    p_request_id, p_user_id, lower(trim(p_request_hash)), normalized_provider,
    'pending:' || p_request_id::text, 'starting',
    greatest(0, coalesce(usage_record.credits_reserved, 0)),
    coalesce(p_deadline_at, now() + interval '25 minutes')
  ) returning * into claimed;

  return jsonb_build_object(
    'ok', true, 'reason', 'claimed',
    'requestId', claimed.request_id, 'userId', claimed.user_id,
    'requestHash', claimed.request_hash, 'providerId', claimed.provider_id,
    'providerTaskId', claimed.provider_task_id, 'pollUrl', claimed.poll_url,
    'resultUrl', claimed.result_url, 'status', claimed.status,
    'creditsReserved', claimed.credits_reserved, 'deadlineAt', claimed.deadline_at
  );
end;
$$;

create or replace function public.record_ai_image_provider_task(
  p_user_id uuid,
  p_request_id uuid,
  p_request_hash text,
  p_provider_id text,
  p_provider_task_id text,
  p_poll_url text default null,
  p_deadline_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_record public.ai_usage%rowtype;
  existing public.ai_image_jobs%rowtype;
  recorded public.ai_image_jobs%rowtype;
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_task text := left(trim(coalesce(p_provider_task_id, '')), 256);
  was_existing boolean := false;
begin
  if p_user_id is null or p_request_id is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{32,128}$'
     or normalized_provider !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or normalized_task = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-request');
  end if;

  select * into usage_record
  from public.ai_usage
  where request_id = p_request_id and user_id = p_user_id and kind = 'image'
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'usage-not-found'); end if;

  select * into existing from public.ai_image_jobs
  where request_id = p_request_id for update;
  if not found then
    insert into public.ai_image_jobs (
      request_id, user_id, request_hash, provider_id, provider_task_id,
      poll_url, credits_reserved, deadline_at
    ) values (
      p_request_id, p_user_id, lower(trim(p_request_hash)), normalized_provider,
      normalized_task, nullif(left(trim(p_poll_url), 2000), ''),
      greatest(0, coalesce(usage_record.credits_reserved, 0)),
      coalesce(p_deadline_at, now() + interval '25 minutes')
    ) returning * into recorded;
  else
    was_existing := true;
    if existing.user_id <> p_user_id or existing.request_hash <> lower(trim(p_request_hash)) then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    if existing.status = 'starting' and left(existing.provider_task_id, 8) = 'pending:' then
      update public.ai_image_jobs
      set provider_id = normalized_provider,
          provider_task_id = normalized_task,
          poll_url = nullif(left(trim(p_poll_url), 2000), ''),
          status = 'submitted',
          deadline_at = coalesce(p_deadline_at, deadline_at),
          updated_at = now()
      where request_id = p_request_id
      returning * into recorded;
    elsif existing.provider_id <> normalized_provider or existing.provider_task_id <> normalized_task then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    else
      recorded := existing;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'reason', case when was_existing then 'already-recorded' else 'recorded' end,
    'requestId', recorded.request_id, 'userId', recorded.user_id,
    'requestHash', recorded.request_hash, 'providerId', recorded.provider_id,
    'providerTaskId', recorded.provider_task_id, 'pollUrl', recorded.poll_url,
    'resultUrl', recorded.result_url, 'status', recorded.status,
    'creditsReserved', recorded.credits_reserved, 'deadlineAt', recorded.deadline_at,
    'errorCode', recorded.error_code, 'errorMessage', recorded.error_message
  );
end;
$$;

-- The shared reservation helper is made re-entrant for the image claim race.
-- It returns the existing reservation instead of treating a retry as a new
-- charge, while still rejecting mismatched request identities.
create or replace function public.reserve_priced_ai_credits_internal(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text, p_duration integer, p_expected_credits integer,
  p_quoted_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
  stale_record record;
begin
  if p_quoted_credits is null or p_quoted_credits < 0 then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if p_expected_credits is not null and p_expected_credits <> p_quoted_credits then
    return jsonb_build_object('ok', false, 'reason', 'pricing-mismatch', 'credits', p_quoted_credits);
  end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id;
  if quota_record.suspended then return jsonb_build_object('ok', false, 'reason', 'account-suspended'); end if;

  for stale_record in
    select usage_row.request_id, usage_row.credits_reserved
    from public.ai_usage as usage_row
    where usage_row.user_id = p_user_id
      and usage_row.status = 'reserved'
      and usage_row.credits_reserved > 0
      and usage_row.created_at < now() - interval '30 minutes'
      and not exists (
        select 1 from public.ai_video_jobs as video_job
        where video_job.request_id = usage_row.request_id
          and video_job.status in ('starting', 'submitted', 'polling')
          and video_job.deadline_at > now()
      )
      and not exists (
        select 1 from public.ai_image_jobs as image_job
        where image_job.request_id = usage_row.request_id
          and image_job.status in ('starting', 'submitted', 'ready')
          and image_job.deadline_at > now()
      )
      and not exists (
        select 1 from public.ai_tool_jobs as tool_job
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
       or usage_record.kind <> p_kind
       or coalesce(usage_record.provider_id, '') <> p_provider_id
       or coalesce(usage_record.resolution, '') <> coalesce(p_resolution, '')
       or usage_record.duration_seconds is distinct from p_duration
       or usage_record.credits_reserved <> p_quoted_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    if usage_record.status = 'reserved' then
      return jsonb_build_object(
        'ok', true, 'reason', 'already-reserved', 'credits', usage_record.credits_reserved,
        'balance', account_record.balance, 'reserved', account_record.reserved,
        'availableCredits', account_record.balance - account_record.reserved
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
  end if;

  if account_record.balance - account_record.reserved < p_quoted_credits then
    return jsonb_build_object(
      'ok', false, 'reason', 'insufficient-credits', 'credits', p_quoted_credits,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, p_kind, p_provider_id, p_resolution, p_duration, p_quoted_credits);

  if p_quoted_credits > 0 then
    update public.ai_credit_accounts
    set reserved = reserved + p_quoted_credits, updated_at = now()
    where user_id = p_user_id returning * into account_record;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'reserve', 0, p_quoted_credits, account_record.balance, account_record.reserved,
       p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
       jsonb_strip_nulls(jsonb_build_object(
         'kind', p_kind, 'providerId', p_provider_id,
         'resolution', p_resolution, 'duration', p_duration
       )))
    on conflict (user_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'reason', 'reserved', 'credits', p_quoted_credits,
    'balance', account_record.balance, 'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved
  );
end;
$$;

revoke all on function public.claim_ai_image_job(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_ai_image_job(uuid, uuid, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
