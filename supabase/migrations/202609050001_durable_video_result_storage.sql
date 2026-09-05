-- Keep completed video bytes in private storage before the desktop receives them.
-- The upstream URL remains as a recovery fallback, but is never the only copy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'messs-ai-video-results', 'messs-ai-video-results', false, 268435456,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.ai_video_jobs
  add column if not exists result_storage_ref text;

alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_result_storage_ref_check;

alter table public.ai_video_jobs
  add constraint ai_video_jobs_result_storage_ref_check
  check (result_storage_ref is null or result_storage_ref ~* '^storage://messs-ai-video-results/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(mp4|webm|mov)$');

create or replace function public.record_ai_video_provider_storage(
  p_request_id uuid,
  p_storage_ref text,
  p_result_content_type text default 'video/mp4',
  p_result_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
  normalized_ref text := trim(coalesce(p_storage_ref, ''));
begin
  if normalized_ref !~* '^storage://messs-ai-video-results/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(mp4|webm|mov)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-storage-ref');
  end if;
  select * into job from public.ai_video_jobs where request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown-request'); end if;
  if job.status not in ('ready', 'succeeded') then
    return jsonb_build_object('ok', false, 'reason', 'job-not-ready', 'status', job.status);
  end if;
  update public.ai_video_jobs
  set result_storage_ref = normalized_ref,
      result_content_type = nullif(left(trim(coalesce(p_result_content_type, 'video/mp4')), 128), ''),
      result_bytes = case when p_result_bytes is null then result_bytes else greatest(0, p_result_bytes) end,
      updated_at = now()
  where request_id = p_request_id
  returning * into job;
  return jsonb_build_object(
    'ok', true, 'reason', 'stored', 'requestId', job.request_id, 'status', job.status,
    'storageRef', job.result_storage_ref, 'contentType', job.result_content_type, 'bytes', job.result_bytes
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
declare
  job public.ai_video_jobs%rowtype;
  usage_record public.ai_usage%rowtype;
begin
  select * into job from public.ai_video_jobs
  where user_id = p_user_id and token_hash = lower(trim(coalesce(p_token_hash, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  select * into usage_record from public.ai_usage where request_id = job.request_id;
  if job.status not in ('ready', 'succeeded')
     or (job.result_url is null and job.result_storage_ref is null)
     or usage_record.status not in ('reserved', 'succeeded') then
    return jsonb_build_object('ok', false, 'reason', 'not-ready', 'status', job.status);
  end if;
  return jsonb_build_object(
    'ok', true, 'requestId', job.request_id, 'status', job.status,
    'url', job.result_url, 'storageRef', job.result_storage_ref,
    'providerId', job.provider_id, 'providerTaskId', job.provider_task_id,
    'contentType', coalesce(job.result_content_type, 'video/mp4'), 'bytes', job.result_bytes,
    'creditsEstimated', job.credits_reserved, 'creditsCharged', usage_record.credits_charged
  );
end;
$$;

revoke all on function public.record_ai_video_provider_storage(uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.record_ai_video_provider_storage(uuid, text, text, bigint)
  to service_role;
revoke all on function public.get_ai_video_job_download(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_ai_video_job_download(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
