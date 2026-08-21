-- MiniMax H3 multimodal reservations and verified-download settlement.
-- This migration is intentionally safe to stage locally: applying it is a
-- separate release operation. One CNY equals 10 app points. Retail uses a 10%
-- upstream-cost buffer followed by a 30% markup and always rounds upward.

alter table public.ai_video_jobs
  add column if not exists provider_total_seconds integer
    check (provider_total_seconds is null or provider_total_seconds between 0 and 3600),
  add column if not exists provider_input_seconds integer
    check (provider_input_seconds is null or provider_input_seconds between 0 and 3600),
  add column if not exists provider_output_seconds integer
    check (provider_output_seconds is null or provider_output_seconds between 0 and 3600),
  add column if not exists provider_input_image_count integer
    check (provider_input_image_count is null or provider_input_image_count between 0 and 100),
  add column if not exists provider_duration_ms integer
    check (provider_duration_ms is null or provider_duration_ms >= 0),
  add column if not exists credits_charged integer
    check (credits_charged is null or credits_charged >= 0);

do $$
declare constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.ai_video_jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table public.ai_video_jobs drop constraint %I',
      constraint_record.conname
    );
  end loop;
end;
$$;

alter table public.ai_video_jobs
  add constraint ai_video_jobs_status_check
    check (status in ('starting', 'submitted', 'polling', 'ready', 'succeeded', 'failed')),
  add constraint ai_video_jobs_completion_check
    check (
      (status in ('starting', 'submitted', 'polling', 'ready') and completed_at is null)
      or (status in ('succeeded', 'failed') and completed_at is not null)
    ),
  add constraint ai_video_jobs_result_check
    check (status not in ('ready', 'succeeded') or result_url is not null);

create or replace function public.reserve_minimax_video_credits(
  p_user_id uuid,
  p_request_id uuid,
  p_resolution text,
  p_duration integer,
  p_expected_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_resolution text := case
    when upper(trim(coalesce(p_resolution, ''))) = '2K' then '2K'
    else '768P'
  end;
  normalized_duration integer := case
    when coalesce(p_duration, 6) = -1 then 15
    else greatest(4, least(15, coalesce(p_duration, 6)))
  end;
  output_credits integer;
  quoted_credits integer;
begin
  output_credits := (
    case normalized_resolution when '2K' then 12 else 8 end
  ) * normalized_duration;

  -- The gateway adds the documented maximum 15 input-video seconds and
  -- charges three points for each input image after the free first five.
  -- Only service_role can call this function, and a quote below the official
  -- output-only floor is rejected closed.
  if p_expected_credits is null or p_expected_credits < output_credits then
    return jsonb_build_object(
      'ok', false,
      'reason', 'pricing-mismatch',
      'credits', output_credits
    );
  end if;
  quoted_credits := p_expected_credits;

  return public.reserve_priced_ai_credits_internal(
    p_user_id,
    'video',
    'video-1',
    p_request_id,
    normalized_resolution,
    normalized_duration,
    quoted_credits,
    quoted_credits
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

  if normalized_provider = 'video-1' then
    reservation := public.reserve_minimax_video_credits(
      p_user_id, p_request_id, p_resolution, p_duration, p_expected_credits
    );
  elsif normalized_provider in (
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

create or replace function public.record_ai_video_provider_result(
  p_request_id uuid,
  p_lease_token uuid,
  p_result_url text,
  p_total_seconds integer default null,
  p_input_seconds integer default null,
  p_output_seconds integer default null,
  p_input_image_count integer default null,
  p_duration_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare job public.ai_video_jobs%rowtype;
begin
  if trim(coalesce(p_result_url, '')) !~* '^https://' then
    raise exception using errcode = '22023', message = 'video result requires HTTPS';
  end if;

  select * into job
  from public.ai_video_jobs
  where request_id = p_request_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown-request'); end if;

  if job.status in ('ready', 'succeeded') then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already-recorded',
      'requestId', job.request_id,
      'status', job.status
    );
  end if;
  if job.status = 'failed' then
    return jsonb_build_object('ok', false, 'reason', 'already-failed');
  end if;
  if job.lease_token is null
     or job.lease_token is distinct from p_lease_token
     or job.leased_until <= now() then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;

  update public.ai_video_jobs
  set status = 'ready',
      result_url = trim(p_result_url),
      provider_total_seconds = case when p_total_seconds >= 0 then p_total_seconds else null end,
      provider_input_seconds = case when p_input_seconds >= 0 then p_input_seconds else null end,
      provider_output_seconds = case when p_output_seconds >= 0 then p_output_seconds else null end,
      provider_input_image_count = case when p_input_image_count >= 0 then p_input_image_count else null end,
      provider_duration_ms = greatest(0, coalesce(p_duration_ms, 0)),
      error_code = null,
      error_message = null,
      lease_token = null,
      leased_by = null,
      leased_until = null,
      updated_at = now()
  where request_id = p_request_id
  returning * into job;

  return jsonb_build_object(
    'ok', true,
    'reason', 'result-recorded',
    'requestId', job.request_id,
    'status', job.status,
    'creditsEstimated', job.credits_reserved
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
declare
  job public.ai_video_jobs%rowtype;
  usage_record public.ai_usage%rowtype;
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;

  select * into usage_record
  from public.ai_usage
  where request_id = job.request_id;

  return jsonb_build_object(
    'ok', true,
    'requestId', job.request_id,
    'status', job.status,
    'credits', job.credits_reserved,
    'creditsCharged', usage_record.credits_charged,
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
declare
  job public.ai_video_jobs%rowtype;
  usage_record public.ai_usage%rowtype;
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;

  select * into usage_record
  from public.ai_usage
  where request_id = job.request_id;

  if job.status not in ('ready', 'succeeded')
     or job.result_url is null
     or usage_record.status not in ('reserved', 'succeeded') then
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
    'bytes', job.result_bytes,
    'creditsEstimated', job.credits_reserved,
    'creditsCharged', usage_record.credits_charged
  );
end;
$$;

create or replace function public.settle_ai_video_download(
  p_user_id uuid,
  p_token_hash text,
  p_result_content_type text,
  p_result_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
  usage_record public.ai_usage%rowtype;
  account_record public.ai_credit_accounts%rowtype;
  settlement jsonb;
  billable_seconds integer;
  image_count integer;
  upstream_cny numeric;
  actual_retail_credits integer;
  target_credits integer;
  top_up integer;
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')))
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;

  if job.status = 'succeeded' then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already-settled',
      'status', job.status,
      'creditsEstimated', job.credits_reserved,
      'creditsCharged', coalesce(job.credits_charged, job.credits_reserved)
    );
  end if;
  if job.status <> 'ready' then
    return jsonb_build_object('ok', false, 'reason', 'not-ready', 'status', job.status);
  end if;

  select * into account_record
  from public.ai_credit_accounts
  where user_id = p_user_id
  for update;
  select * into usage_record
  from public.ai_usage
  where request_id = job.request_id
  for update;

  if usage_record.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'reason', 'usage-not-reserved');
  end if;

  target_credits := job.credits_reserved;
  if job.provider_id = 'video-1' then
    billable_seconds := case
      when job.provider_output_seconds is not null or job.provider_input_seconds is not null
        then coalesce(job.provider_output_seconds, job.duration_seconds)
          + coalesce(job.provider_input_seconds, 0)
      when job.provider_total_seconds is not null then job.provider_total_seconds
      else job.duration_seconds
    end;
    image_count := greatest(0, coalesce(job.provider_input_image_count, 0));
    upstream_cny := (
      case when upper(job.resolution) = '2K' then 0.80 else 0.50 end
    ) * greatest(0, billable_seconds)
      + 0.20 * greatest(0, image_count - 5);
    actual_retail_credits := ceil(upstream_cny * 10 * 1.10 * 1.30)::integer;
    target_credits := greatest(target_credits, actual_retail_credits);
  end if;

  top_up := greatest(0, target_credits - usage_record.credits_reserved);
  if top_up > 0 then
    if account_record.balance - account_record.reserved < top_up then
      settlement := public.settle_ai_credits(job.request_id, 'failed', coalesce(job.provider_duration_ms, 0));
      update public.ai_video_jobs
      set status = 'failed',
          result_url = null,
          result_content_type = null,
          result_bytes = null,
          credits_charged = 0,
          error_code = 'insufficient-credits',
          error_message = 'The actual provider cost exceeded the available point balance.',
          completed_at = now(),
          updated_at = now()
      where request_id = job.request_id;
      return jsonb_build_object(
        'ok', false,
        'reason', 'insufficient-credits',
        'creditsEstimated', job.credits_reserved,
        'creditsCharged', 0,
        'creditsReleased', job.credits_reserved
      );
    end if;

    update public.ai_credit_accounts
    set reserved = reserved + top_up,
        updated_at = now()
    where user_id = p_user_id
    returning * into account_record;

    update public.ai_usage
    set credits_reserved = credits_reserved + top_up
    where request_id = job.request_id
    returning * into usage_record;

    insert into public.ai_credit_ledger (
      user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
      request_id, reference_id, idempotency_key, metadata
    ) values (
      p_user_id, 'reserve', 0, top_up, account_record.balance, account_record.reserved,
      job.request_id, job.request_id::text, 'video-topup:' || job.request_id::text,
      jsonb_build_object(
        'kind', 'video',
        'providerId', job.provider_id,
        'actualRetailCredits', target_credits
      )
    )
    on conflict (user_id, idempotency_key) do nothing;
  end if;

  settlement := public.settle_ai_credits(
    job.request_id,
    'succeeded',
    coalesce(job.provider_duration_ms, 0)
  );
  if coalesce((settlement->>'ok')::boolean, false) is not true
     or coalesce(settlement->>'status', '') <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'video credit settlement failed';
  end if;

  update public.ai_video_jobs
  set status = 'succeeded',
      result_content_type = nullif(left(trim(coalesce(p_result_content_type, 'video/mp4')), 128), ''),
      result_bytes = greatest(0, p_result_bytes),
      credits_charged = coalesce((settlement->>'creditsCharged')::integer, target_credits),
      error_code = null,
      error_message = null,
      completed_at = now(),
      updated_at = now()
  where request_id = job.request_id
  returning * into job;

  return jsonb_build_object(
    'ok', true,
    'reason', 'settled',
    'status', job.status,
    'creditsEstimated', job.credits_reserved,
    'creditsCharged', job.credits_charged,
    'providerTotalSeconds', job.provider_total_seconds,
    'providerInputSeconds', job.provider_input_seconds,
    'providerOutputSeconds', job.provider_output_seconds,
    'providerInputImageCount', job.provider_input_image_count
  );
end;
$$;

create or replace function public.fail_ai_video_download(
  p_user_id uuid,
  p_token_hash text,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
  settlement jsonb;
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')))
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if job.status = 'succeeded' then
    return jsonb_build_object('ok', false, 'reason', 'already-settled');
  end if;
  if job.status = 'failed' then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already-failed',
      'creditsCharged', 0
    );
  end if;
  if job.status <> 'ready' then
    return jsonb_build_object('ok', false, 'reason', 'not-ready');
  end if;

  settlement := public.settle_ai_credits(
    job.request_id,
    'failed',
    coalesce(job.provider_duration_ms, 0)
  );
  if coalesce((settlement->>'ok')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'video credit release failed';
  end if;

  update public.ai_video_jobs
  set status = 'failed',
      result_url = null,
      result_content_type = null,
      result_bytes = null,
      credits_charged = 0,
      error_code = nullif(left(lower(trim(coalesce(p_error_code, 'video-download-failed'))), 64), ''),
      error_message = nullif(left(trim(coalesce(p_error_message, 'The generated video could not be downloaded.')), 300), ''),
      completed_at = now(),
      updated_at = now()
  where request_id = job.request_id;

  return jsonb_build_object(
    'ok', true,
    'reason', 'released',
    'status', 'failed',
    'creditsEstimated', job.credits_reserved,
    'creditsCharged', 0,
    'creditsReleased', job.credits_reserved
  );
end;
$$;

revoke all on function public.reserve_minimax_video_credits(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.record_ai_video_provider_result(uuid, uuid, text, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.get_ai_video_job_owner_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_ai_video_job_download(uuid, text)
  from public, anon, authenticated;
revoke all on function public.settle_ai_video_download(uuid, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.fail_ai_video_download(uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.reserve_minimax_video_credits(uuid, uuid, text, integer, integer)
  to service_role;
grant execute on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer)
  to service_role;
grant execute on function public.record_ai_video_provider_result(uuid, uuid, text, integer, integer, integer, integer, integer)
  to service_role;
grant execute on function public.get_ai_video_job_owner_status(uuid, text)
  to service_role;
grant execute on function public.get_ai_video_job_download(uuid, text)
  to service_role;
grant execute on function public.settle_ai_video_download(uuid, text, text, bigint)
  to service_role;
grant execute on function public.fail_ai_video_download(uuid, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
