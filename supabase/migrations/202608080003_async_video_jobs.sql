-- Durable asynchronous video jobs for MiniMax. Provider credentials, prompts,
-- reference images, and plaintext session tokens must never be stored here.

create table if not exists public.ai_video_jobs (
  request_id uuid primary key references public.ai_usage(request_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  provider_id text not null check (provider_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  provider_task_id text check (provider_task_id is null or char_length(provider_task_id) between 1 and 256),
  status text not null default 'starting'
    check (status in ('starting', 'submitted', 'polling', 'succeeded', 'failed')),
  resolution text not null check (resolution in ('768P', '2K')),
  duration_seconds integer not null check (duration_seconds between 4 and 15),
  aspect_ratio text not null check (char_length(aspect_ratio) between 1 and 16),
  credits_reserved integer not null check (credits_reserved >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_poll_at timestamptz not null default now(),
  lease_token uuid,
  leased_by text check (leased_by is null or char_length(leased_by) between 1 and 128),
  leased_until timestamptz,
  result_url text check (result_url is null or (char_length(result_url) <= 4096 and result_url ~* '^https://')),
  result_content_type text check (result_content_type is null or char_length(result_content_type) <= 128),
  result_bytes bigint check (result_bytes is null or result_bytes between 0 and 268435456),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  error_message text check (error_message is null or char_length(error_message) <= 300),
  deadline_at timestamptz not null default (now() + interval '20 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (status in ('starting', 'submitted', 'polling') and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  ),
  check (status <> 'succeeded' or result_url is not null)
);

create unique index if not exists ai_video_jobs_provider_task_idx
  on public.ai_video_jobs (provider_id, provider_task_id)
  where provider_task_id is not null;
create unique index if not exists ai_video_jobs_token_hash_idx
  on public.ai_video_jobs (token_hash);
create index if not exists ai_video_jobs_due_idx
  on public.ai_video_jobs (next_poll_at, leased_until)
  where status in ('submitted', 'polling');
create index if not exists ai_video_jobs_starting_deadline_idx
  on public.ai_video_jobs (deadline_at, leased_until)
  where status = 'starting';
create index if not exists ai_video_jobs_user_created_idx
  on public.ai_video_jobs (user_id, created_at desc);

alter table public.ai_video_jobs enable row level security;
revoke all on table public.ai_video_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_video_jobs to service_role;

-- Replace the forward model-access migration's reservation function so its
-- stale cleanup cannot release credits belonging to a live asynchronous job.
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
    quoted_credits := case normalized_provider
      when 'image-1' then 16
      when 'image-2' then 7
      when 'image-3' then 5
      when 'image-4' then 4
      when 'image-5' then 8
      else null
    end;
    if quoted_credits is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    if normalized_provider <> 'video-1' then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    normalized_resolution := case when upper(trim(coalesce(p_resolution, '768P'))) = '2K' then '2K' else '768P' end;
    normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
    quoted_credits := (case normalized_resolution when '2K' then 16 else 10 end) * normalized_duration;
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
    order by usage_row.created_at
    for update of usage_row
  loop
    update public.ai_credit_accounts
    set reserved = greatest(0, reserved - stale_record.credits_reserved), updated_at = now()
    where user_id = p_user_id returning * into account_record;
    update public.ai_usage
    set status = 'failed', completed_at = now(), duration_ms = null
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
    if usage_record.user_id <> p_user_id
       or usage_record.kind <> normalized_kind
       or coalesce(usage_record.provider_id, '') <> normalized_provider
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

create or replace function public.start_ai_video_job(
  p_request_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_request_hash text,
  p_provider_id text,
  p_resolution text,
  p_duration integer,
  p_aspect_ratio text,
  p_expected_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_job public.ai_video_jobs%rowtype;
  reservation jsonb;
begin
  if lower(trim(coalesce(p_token_hash, ''))) !~ '^[0-9a-f]{64}$'
     or lower(trim(coalesce(p_request_hash, ''))) !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-job-hash');
  end if;

  select * into existing_job
  from public.ai_video_jobs
  where request_id = p_request_id
  for update;
  if found then
    if existing_job.user_id <> p_user_id
       or existing_job.token_hash <> lower(trim(p_token_hash))
       or existing_job.request_hash <> lower(trim(p_request_hash))
       or existing_job.provider_id <> lower(trim(p_provider_id)) then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'reason', 'already-started',
      'requestId', existing_job.request_id,
      'status', existing_job.status,
      'credits', existing_job.credits_reserved,
      'createdAt', existing_job.created_at,
      'deadlineAt', existing_job.deadline_at
    );
  end if;

  reservation := public.reserve_ai_credits(
    p_user_id,
    'video',
    p_provider_id,
    p_request_id,
    p_resolution,
    p_duration,
    p_expected_credits
  );
  if coalesce((reservation->>'ok')::boolean, false) is not true then
    return reservation;
  end if;

  insert into public.ai_video_jobs (
    request_id, user_id, token_hash, request_hash, provider_id,
    resolution, duration_seconds, aspect_ratio, credits_reserved
  ) values (
    p_request_id, p_user_id, lower(trim(p_token_hash)), lower(trim(p_request_hash)),
    lower(trim(p_provider_id)), upper(trim(p_resolution)), p_duration,
    trim(p_aspect_ratio), coalesce((reservation->>'credits')::integer, 0)
  ) returning * into existing_job;

  return reservation || jsonb_build_object(
    'requestId', existing_job.request_id,
    'status', existing_job.status,
    'createdAt', existing_job.created_at,
    'deadlineAt', existing_job.deadline_at
  );
end;
$$;

create or replace function public.attach_ai_video_provider_task(
  p_request_id uuid,
  p_provider_task_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
  normalized_task_id text := trim(coalesce(p_provider_task_id, ''));
begin
  if char_length(normalized_task_id) not between 1 and 256 then
    return jsonb_build_object('ok', false, 'reason', 'invalid-provider-task');
  end if;
  select * into job from public.ai_video_jobs where request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown-request'); end if;
  if job.status in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'job-already-finalized', 'status', job.status);
  end if;
  if job.provider_task_id is not null and job.provider_task_id <> normalized_task_id then
    return jsonb_build_object('ok', false, 'reason', 'provider-task-conflict');
  end if;
  if job.provider_task_id = normalized_task_id then
    return jsonb_build_object('ok', true, 'reason', 'already-attached', 'requestId', job.request_id,
      'status', job.status, 'nextPollAt', job.next_poll_at);
  end if;
  update public.ai_video_jobs
  set provider_task_id = normalized_task_id,
      status = 'submitted',
      next_poll_at = now() + interval '8 seconds',
      updated_at = now()
  where request_id = p_request_id
  returning * into job;
  return jsonb_build_object('ok', true, 'reason', 'attached', 'requestId', job.request_id,
    'status', job.status, 'nextPollAt', job.next_poll_at);
end;
$$;

create or replace function public.claim_due_ai_video_jobs(
  p_worker_id text,
  p_limit integer default 4,
  p_lease_seconds integer default 60
)
returns table (
  request_id uuid,
  provider_id text,
  provider_task_id text,
  status text,
  attempt_count integer,
  lease_token uuid,
  deadline_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'invalid worker id';
  end if;
  return query
  with due as (
    select job.request_id
    from public.ai_video_jobs as job
    where (
        (job.status in ('submitted', 'polling')
          and job.provider_task_id is not null
          and job.next_poll_at <= now())
        or (job.status = 'starting' and job.deadline_at <= now())
      )
      and (job.leased_until is null or job.leased_until <= now())
    order by job.next_poll_at, job.created_at
    for update skip locked
    limit greatest(1, least(25, coalesce(p_limit, 4)))
  )
  update public.ai_video_jobs as job
  set lease_token = gen_random_uuid(),
      leased_by = left(trim(p_worker_id), 128),
      leased_until = now() + make_interval(secs => greatest(10, least(300, coalesce(p_lease_seconds, 60)))),
      updated_at = now()
  from due
  where job.request_id = due.request_id
  returning job.request_id, job.provider_id, job.provider_task_id, job.status,
    job.attempt_count, job.lease_token, job.deadline_at, job.created_at;
end;
$$;

create or replace function public.reschedule_ai_video_job(
  p_request_id uuid,
  p_lease_token uuid,
  p_delay_seconds integer,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
begin
  select * into job from public.ai_video_jobs where request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown-request'); end if;
  if job.status not in ('submitted', 'polling') then
    return jsonb_build_object('ok', false, 'reason', 'job-not-active', 'status', job.status);
  end if;
  if job.lease_token is null
     or job.lease_token is distinct from p_lease_token
     or job.leased_until is null
     or job.leased_until <= now() then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;
  update public.ai_video_jobs
  set status = 'polling',
      attempt_count = attempt_count + 1,
      next_poll_at = now() + make_interval(secs => greatest(3, least(300, coalesce(p_delay_seconds, 10)))),
      lease_token = null,
      leased_by = null,
      leased_until = null,
      error_code = nullif(left(lower(trim(coalesce(p_error_code, ''))), 64), ''),
      error_message = nullif(left(trim(coalesce(p_error_message, '')), 300), ''),
      updated_at = now()
  where request_id = p_request_id
  returning * into job;
  return jsonb_build_object('ok', true, 'reason', 'rescheduled', 'requestId', job.request_id,
    'status', job.status, 'attemptCount', job.attempt_count, 'nextPollAt', job.next_poll_at);
end;
$$;

create or replace function public.finalize_ai_video_job(
  p_request_id uuid,
  p_lease_token uuid,
  p_status text,
  p_result_url text default null,
  p_result_content_type text default null,
  p_result_bytes bigint default null,
  p_error_code text default null,
  p_error_message text default null,
  p_duration_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
  normalized_status text := lower(trim(coalesce(p_status, '')));
  settlement jsonb;
begin
  if normalized_status not in ('succeeded', 'failed') then
    raise exception using errcode = '22023', message = 'invalid final video job status';
  end if;
  if normalized_status = 'succeeded' and trim(coalesce(p_result_url, '')) !~* '^https://' then
    raise exception using errcode = '22023', message = 'successful video job requires an HTTPS result';
  end if;

  select * into job from public.ai_video_jobs where request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown-request'); end if;
  if job.status in ('succeeded', 'failed') and job.status <> normalized_status then
    raise exception using errcode = '23514', message = 'video job final status mismatch';
  end if;
  if job.status not in ('succeeded', 'failed') then
    if job.lease_token is not null then
      if job.lease_token is distinct from p_lease_token or job.leased_until <= now() then
        return jsonb_build_object('ok', false, 'reason', 'lease-lost');
      end if;
    elsif job.status <> 'starting' then
      return jsonb_build_object('ok', false, 'reason', 'lease-required');
    end if;
  end if;

  settlement := public.settle_ai_credits(
    p_request_id,
    normalized_status,
    greatest(0, coalesce(p_duration_ms, 0))
  );
  if coalesce((settlement->>'ok')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'credit settlement rejected video finalization';
  end if;
  if coalesce(settlement->>'status', '') <> normalized_status then
    raise exception using errcode = '23514', message = 'credit settlement status mismatch';
  end if;

  if job.status in ('succeeded', 'failed') then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already-finalized',
      'requestId', job.request_id,
      'status', job.status,
      'creditsCharged', coalesce((settlement->>'creditsCharged')::integer, 0),
      'creditsReleased', coalesce((settlement->>'creditsReleased')::integer, 0),
      'completedAt', job.completed_at
    );
  end if;

  update public.ai_video_jobs
  set status = normalized_status,
      result_url = case when normalized_status = 'succeeded' then trim(p_result_url) else null end,
      result_content_type = case when normalized_status = 'succeeded'
        then nullif(left(trim(coalesce(p_result_content_type, 'video/mp4')), 128), '') else null end,
      result_bytes = case when normalized_status = 'succeeded' then p_result_bytes else null end,
      error_code = case when normalized_status = 'failed'
        then nullif(left(lower(trim(coalesce(p_error_code, 'video-generation-failed'))), 64), '') else null end,
      error_message = case when normalized_status = 'failed'
        then nullif(left(trim(coalesce(p_error_message, 'Video generation failed.')), 300), '') else null end,
      lease_token = null,
      leased_by = null,
      leased_until = null,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where request_id = p_request_id
  returning * into job;

  return jsonb_build_object(
    'ok', true,
    'reason', case when settlement->>'reason' = 'already-settled' then 'already-finalized' else 'finalized' end,
    'requestId', job.request_id,
    'status', job.status,
    'creditsCharged', coalesce((settlement->>'creditsCharged')::integer, 0),
    'creditsReleased', coalesce((settlement->>'creditsReleased')::integer, 0),
    'completedAt', job.completed_at
  );
end;
$$;

create or replace function public.get_ai_video_job_owner_status(
  p_user_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare job public.ai_video_jobs%rowtype;
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  return jsonb_build_object(
    'ok', true,
    'requestId', job.request_id,
    'status', job.status,
    'credits', job.credits_reserved,
    'attemptCount', job.attempt_count,
    'errorCode', job.error_code,
    'errorMessage', job.error_message,
    'createdAt', job.created_at,
    'updatedAt', job.updated_at,
    'completedAt', job.completed_at
  );
end;
$$;

create or replace function public.get_ai_video_job_download(
  p_user_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare job public.ai_video_jobs%rowtype;
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if job.status <> 'succeeded'
     or job.result_url is null
     or not exists (
       select 1 from public.ai_usage as usage_row
       where usage_row.request_id = job.request_id
         and usage_row.user_id = job.user_id
         and usage_row.status = 'succeeded'
     ) then
    return jsonb_build_object('ok', false, 'reason', 'not-ready', 'status', job.status);
  end if;
  return jsonb_build_object(
    'ok', true,
    'requestId', job.request_id,
    'status', job.status,
    'url', job.result_url,
    'providerId', job.provider_id,
    'providerTaskId', job.provider_task_id,
    'contentType', coalesce(job.result_content_type, 'video/mp4'),
    'bytes', job.result_bytes
  );
end;
$$;

revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.attach_ai_video_provider_task(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_due_ai_video_jobs(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.reschedule_ai_video_job(uuid, uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.finalize_ai_video_job(uuid, uuid, text, text, text, bigint, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_ai_video_job_owner_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_ai_video_job_download(uuid, text)
  from public, anon, authenticated;

grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
grant execute on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer)
  to service_role;
grant execute on function public.attach_ai_video_provider_task(uuid, text)
  to service_role;
grant execute on function public.claim_due_ai_video_jobs(text, integer, integer)
  to service_role;
grant execute on function public.reschedule_ai_video_job(uuid, uuid, integer, text, text)
  to service_role;
grant execute on function public.finalize_ai_video_job(uuid, uuid, text, text, text, bigint, text, text, integer)
  to service_role;
grant execute on function public.get_ai_video_job_owner_status(uuid, text)
  to service_role;
grant execute on function public.get_ai_video_job_download(uuid, text)
  to service_role;
