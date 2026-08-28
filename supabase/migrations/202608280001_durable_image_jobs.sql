-- Persist accepted image tasks so a gateway restart or a dropped response can
-- resume the same upstream task without creating a second billable request.

create table if not exists public.ai_image_jobs (
  request_id uuid primary key references public.ai_usage(request_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null check (char_length(request_hash) between 32 and 128),
  provider_id text not null check (provider_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  provider_task_id text not null check (char_length(provider_task_id) between 1 and 256),
  poll_url text,
  result_url text,
  status text not null default 'submitted' check (status in ('submitted', 'ready', 'failed')),
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  deadline_at timestamptz not null default (now() + interval '25 minutes'),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_image_jobs_user_status_idx
  on public.ai_image_jobs (user_id, status, updated_at desc);

alter table public.ai_image_jobs enable row level security;

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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
begin
  if p_user_id is null or p_request_id is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{32,128}$'
     or normalized_provider !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or coalesce(p_provider_task_id, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-request');
  end if;

  select * into usage_record
  from public.ai_usage
  where request_id = p_request_id and user_id = p_user_id and kind = 'image'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'usage-not-found');
  end if;

  select * into existing from public.ai_image_jobs
  where request_id = p_request_id for update;
  if found then
    if existing.user_id <> p_user_id
       or existing.request_hash <> p_request_hash
       or existing.provider_id <> normalized_provider
       or existing.provider_task_id <> p_provider_task_id then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'reason', 'already-recorded',
      'requestId', existing.request_id,
      'userId', existing.user_id,
      'requestHash', existing.request_hash,
      'providerId', existing.provider_id,
      'providerTaskId', existing.provider_task_id,
      'pollUrl', existing.poll_url,
      'resultUrl', existing.result_url,
      'status', existing.status,
      'creditsReserved', existing.credits_reserved,
      'deadlineAt', existing.deadline_at,
      'errorCode', existing.error_code,
      'errorMessage', existing.error_message
    );
  end if;

  insert into public.ai_image_jobs (
    request_id, user_id, request_hash, provider_id, provider_task_id,
    poll_url, credits_reserved, deadline_at
  ) values (
    p_request_id, p_user_id, p_request_hash, normalized_provider,
    left(trim(p_provider_task_id), 256), nullif(left(trim(p_poll_url), 2000), ''),
    greatest(0, coalesce(usage_record.credits_reserved, 0)),
    coalesce(p_deadline_at, now() + interval '25 minutes')
  ) returning * into existing;

  return jsonb_build_object(
    'ok', true, 'reason', 'recorded',
    'requestId', existing.request_id,
    'userId', existing.user_id,
    'requestHash', existing.request_hash,
    'providerId', existing.provider_id,
    'providerTaskId', existing.provider_task_id,
    'pollUrl', existing.poll_url,
    'resultUrl', existing.result_url,
    'status', existing.status,
    'creditsReserved', existing.credits_reserved,
    'deadlineAt', existing.deadline_at
  );
end;
$$;

create or replace function public.get_ai_image_job(
  p_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_image_jobs%rowtype;
begin
  select * into job from public.ai_image_jobs
  where user_id = p_user_id and request_id = p_request_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  return jsonb_build_object(
    'ok', true, 'reason', 'found',
    'requestId', job.request_id,
    'userId', job.user_id,
    'requestHash', job.request_hash,
    'providerId', job.provider_id,
    'providerTaskId', job.provider_task_id,
    'pollUrl', job.poll_url,
    'resultUrl', job.result_url,
    'status', job.status,
    'creditsReserved', job.credits_reserved,
    'deadlineAt', job.deadline_at,
    'errorCode', job.error_code,
    'errorMessage', job.error_message
  );
end;
$$;

create or replace function public.record_ai_image_provider_result(
  p_user_id uuid,
  p_request_id uuid,
  p_result_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_image_jobs%rowtype;
begin
  select * into job from public.ai_image_jobs
  where user_id = p_user_id and request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if coalesce(p_result_url, '') !~ '^https://[^[:space:]]{1,2000}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-result-url');
  end if;
  update public.ai_image_jobs
  set status = 'ready', result_url = left(trim(p_result_url), 2000), updated_at = now(),
      error_code = null, error_message = null
  where request_id = p_request_id
  returning * into job;
  return jsonb_build_object(
    'ok', true, 'reason', 'ready',
    'requestId', job.request_id,
    'userId', job.user_id,
    'requestHash', job.request_hash,
    'providerId', job.provider_id,
    'providerTaskId', job.provider_task_id,
    'pollUrl', job.poll_url,
    'resultUrl', job.result_url,
    'status', job.status,
    'creditsReserved', job.credits_reserved,
    'deadlineAt', job.deadline_at
  );
end;
$$;

create or replace function public.fail_ai_image_job(
  p_user_id uuid,
  p_request_id uuid,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_image_jobs%rowtype;
begin
  select * into job from public.ai_image_jobs
  where user_id = p_user_id and request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  update public.ai_image_jobs
  set status = 'failed', error_code = left(coalesce(p_error_code, 'image-generation-failed'), 64),
      error_message = left(coalesce(p_error_message, 'Image generation failed.'), 300), updated_at = now()
  where request_id = p_request_id
  returning * into job;
  return jsonb_build_object(
    'ok', true, 'reason', 'failed',
    'requestId', job.request_id,
    'userId', job.user_id,
    'requestHash', job.request_hash,
    'providerId', job.provider_id,
    'providerTaskId', job.provider_task_id,
    'pollUrl', job.poll_url,
    'resultUrl', job.result_url,
    'status', job.status,
    'creditsReserved', job.credits_reserved,
    'deadlineAt', job.deadline_at,
    'errorCode', job.error_code,
    'errorMessage', job.error_message
  );
end;
$$;

revoke all on function public.record_ai_image_provider_task(uuid, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_ai_image_job(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.record_ai_image_provider_result(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_ai_image_job(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_ai_image_provider_task(uuid, uuid, text, text, text, text, timestamptz)
  to service_role;
grant execute on function public.get_ai_image_job(uuid, uuid) to service_role;
grant execute on function public.record_ai_image_provider_result(uuid, uuid, text) to service_role;
grant execute on function public.fail_ai_image_job(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
