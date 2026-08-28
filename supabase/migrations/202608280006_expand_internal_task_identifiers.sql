-- Routed task identifiers contain an internal route prefix plus the actual
-- upstream task id. Keep this storage limit separate from the public API and
-- large enough for long provider identifiers without exposing either part.

alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_provider_task_id_check;

alter table public.ai_video_jobs
  add constraint ai_video_jobs_provider_task_id_check
  check (provider_task_id is null or char_length(provider_task_id) between 1 and 512);

alter table public.ai_image_jobs
  drop constraint if exists ai_image_jobs_provider_task_id_check;

alter table public.ai_image_jobs
  add constraint ai_image_jobs_provider_task_id_check
  check (char_length(provider_task_id) between 1 and 512);

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
  if char_length(normalized_task_id) not between 1 and 512 then
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
  normalized_task text := left(trim(coalesce(p_provider_task_id, '')), 512);
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

revoke all on function public.attach_ai_video_provider_task(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_ai_image_provider_task(uuid, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.attach_ai_video_provider_task(uuid, text) to service_role;
grant execute on function public.record_ai_image_provider_task(uuid, uuid, text, text, text, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
