-- Keep asynchronous Seedance jobs compatible with the full Atlas capability
-- matrix. Older migrations only accepted the legacy 480P/720P pair, so a
-- valid super-resolution or 4K request failed before it reached the provider.

alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_resolution_check;
alter table public.ai_video_jobs
  add constraint ai_video_jobs_resolution_check
  check (upper(trim(resolution)) in (
    '480P', '720P', '720P-SR', '720P-ESR', '768P', '1080P', '1080P-SR',
    '1080P-ESR', '1080P-ESR & 60FPS', '1440P-SR', '1440P-ESR', '2K',
    '4K', '4K-ESR'
  ));

alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_duration_seconds_check;
alter table public.ai_video_jobs
  add constraint ai_video_jobs_duration_seconds_check
  check (duration_seconds between 3 and 30);

-- The logical video-2/video-3 IDs are the public model IDs. Their Atlas
-- primary and 302 fallback routes share one server-authoritative quote, so
-- the async start RPC must use the same Atlas catalog function as the normal
-- media reservation path.
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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
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
       or existing_job.provider_id <> normalized_provider then
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

  if normalized_provider in (
    'video-2', 'video-3',
    'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
  ) then
    reservation := public.reserve_atlas_catalog_credits(
      p_user_id, 'video', normalized_provider, p_request_id,
      p_resolution, p_duration, p_expected_credits
    );
  elsif normalized_provider in ('video-10', 'video-11', 'video-12', 'video-13') then
    reservation := public.reserve_kling_video_credits(
      p_user_id, 'video', normalized_provider, p_request_id,
      p_resolution, p_duration, p_expected_credits
    );
  else
    reservation := public.reserve_ai_credits(
      p_user_id, 'video', normalized_provider, p_request_id,
      p_resolution, p_duration, p_expected_credits
    );
  end if;
  if coalesce((reservation->>'ok')::boolean, false) is not true then
    return reservation;
  end if;

  insert into public.ai_video_jobs (
    request_id, user_id, token_hash, request_hash, provider_id,
    resolution, duration_seconds, aspect_ratio, credits_reserved
  ) values (
    p_request_id, p_user_id, lower(trim(p_token_hash)), lower(trim(p_request_hash)),
    normalized_provider, upper(trim(p_resolution)), p_duration,
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

revoke all on function public.start_ai_video_job(
  uuid, uuid, text, text, text, text, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.start_ai_video_job(
  uuid, uuid, text, text, text, text, integer, text, integer
) to service_role;

notify pgrst, 'reload schema';
