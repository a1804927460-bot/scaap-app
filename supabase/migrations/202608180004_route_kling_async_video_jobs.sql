-- Route asynchronous Kling V3/O3 jobs through the Kling-specific pricing RPC.
-- The original start_ai_video_job function always called reserve_ai_credits,
-- whose provider allow-list predates video-10..video-13. That made valid Kling
-- video-edit requests fail before they reached 302 with provider-not-allowed.

alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_resolution_check;
alter table public.ai_video_jobs
  add constraint ai_video_jobs_resolution_check
  check (resolution in ('480P', '720P', '768P', '1080P', '2K'));
alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_duration_seconds_check;
alter table public.ai_video_jobs
  add constraint ai_video_jobs_duration_seconds_check
  check (duration_seconds between 3 and 30);

-- Keep this migration self-contained for projects that applied the async-job
-- migration but missed the earlier Kling pricing migration.
create or replace function public.reserve_kling_video_credits(
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
  upstream_credits numeric;
  quoted_credits integer;
begin
  if normalized_kind <> 'video' then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  if normalized_provider = 'video-10' then
    normalized_resolution := '720P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 18.4 * normalized_duration;
  elsif normalized_provider = 'video-11' then
    normalized_resolution := '1080P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 24.6 * normalized_duration;
  elsif normalized_provider = 'video-12' then
    normalized_resolution := '720P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 21.9 * normalized_duration;
  elsif normalized_provider = 'video-13' then
    normalized_resolution := '1080P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 26.3 * normalized_duration;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  quoted_credits := greatest(30, ceil(upstream_credits + 14)::integer);
  quoted_credits := public.apply_ai_pricing_tier(
    p_user_id, quoted_credits, upstream_credits
  );
  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

revoke all on function public.reserve_kling_video_credits(
  uuid, text, text, uuid, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_kling_video_credits(
  uuid, text, text, uuid, text, integer, integer
) to service_role;

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

  -- Kling has a separate server-authoritative quote table. Keep this branch
  -- inside the job transaction so reservation and job creation remain atomic.
  if normalized_provider in ('video-10', 'video-11', 'video-12', 'video-13') then
    reservation := public.reserve_kling_video_credits(
      p_user_id,
      'video',
      normalized_provider,
      p_request_id,
      p_resolution,
      p_duration,
      p_expected_credits
    );
  else
    reservation := public.reserve_ai_credits(
      p_user_id,
      'video',
      normalized_provider,
      p_request_id,
      p_resolution,
      p_duration,
      p_expected_credits
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
