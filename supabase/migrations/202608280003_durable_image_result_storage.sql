-- Store completed synchronous image outputs privately before the gateway
-- confirms delivery. A retry can then return the same bytes without another
-- billable upstream submission.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'messs-ai-image-results', 'messs-ai-image-results', false, 67108864,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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
  normalized_result text := trim(coalesce(p_result_url, ''));
  expected_storage_result text;
begin
  select * into job from public.ai_image_jobs
  where user_id = p_user_id and request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;

  if normalized_result !~ '^https://[^[:space:]]{1,2000}$'
     and normalized_result !~ '^storage://messs-ai-image-results/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-result-url');
  end if;

  if lower(normalized_result) like 'storage://messs-ai-image-results/%' then
    expected_storage_result := format(
      'storage://messs-ai-image-results/%s/%s.', lower(job.user_id::text), lower(job.request_id::text)
    );
    if lower(normalized_result) not like expected_storage_result || '%' then
      return jsonb_build_object('ok', false, 'reason', 'result-owner-mismatch');
    end if;
  end if;

  update public.ai_image_jobs
  set status = 'ready', result_url = left(normalized_result, 2000), updated_at = now(),
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

notify pgrst, 'reload schema';
