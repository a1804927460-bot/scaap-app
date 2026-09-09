-- Atlas account prices verified 2026-09-09; five Kling variants, sound and SR priced separately.
BEGIN;
create or replace function public.quote_ai_video_retail_credits(
  p_provider_id text,
  p_resolution text default null,
  p_duration integer default 6,
  p_reference_image_count integer default 0,
  p_has_reference_video boolean default false
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  provider_id text := lower(trim(coalesce(p_provider_id, '')));
  resolution text := upper(trim(coalesce(p_resolution, '')));
  duration integer;
  rate_points numeric;
  minimum_points numeric := 0;
  upstream_cny numeric;
begin
  if provider_id in ('atlas-kling-standard-silent','atlas-kling-standard-audio','atlas-kling-pro-silent','atlas-kling-pro-audio','atlas-kling-turbo-silent','atlas-kling-v3-4k-silent','atlas-kling-v3-4k-audio','atlas-kling-o3-4k-silent','atlas-kling-o3-4k-audio') then
    if p_duration is null or p_duration < 3 or p_duration > 15 then return null; end if;
    if provider_id not like '%4k%' and p_duration not in (5,10) then return null; end if;
    upstream_cny := case provider_id
    when 'atlas-kling-standard-silent' then case resolution
      when '720P' then 0.0714
      when '1080P-SR' then 0.08568
      when '1440P-SR' then 0.1523176
      else null end
    when 'atlas-kling-standard-audio' then case resolution
      when '720P' then 0.1071
      when '1080P-SR' then 0.12852
      when '1440P-SR' then 0.2284764
      else null end
    when 'atlas-kling-pro-silent' then case resolution
      when '1080P' then 0.0952
      when '1440P-SR' then 0.1353934
      else null end
    when 'atlas-kling-pro-audio' then case resolution
      when '1080P' then 0.1428
      when '1440P-SR' then 0.2030902
      else null end
    when 'atlas-kling-turbo-silent' then case resolution
      when '720P' then 0.0952
      when '1080P' then 0.119
      else null end
    when 'atlas-kling-v3-4k-silent' then case resolution
      when '4K' then 0.357
      else null end
    when 'atlas-kling-v3-4k-audio' then case resolution
      when '4K' then 0.357
      else null end
    when 'atlas-kling-o3-4k-silent' then case resolution
      when '4K' then 0.357
      else null end
    when 'atlas-kling-o3-4k-audio' then case resolution
      when '4K' then 0.357
      else null end
    else null end;
    if upstream_cny is null then return null; end if;
    return public.quote_media_retail_credits_from_cny(upstream_cny * p_duration * 7.3 + 0.250);
  end if;

  if provider_id = 'video-1' then
    duration := case when coalesce(p_duration, 6) = -1 then 15 else greatest(4, least(15, coalesce(p_duration, 6))) end;
    return public.quote_minimax_h3_video_retail_credits(
      case when resolution = '2K' then '2K' else '768P' end,
      duration,
      case when coalesce(p_has_reference_video, false) then 15 else 0 end,
      greatest(0, coalesce(p_reference_image_count, 0))
    );
  end if;

  if provider_id in ('video-2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref') then
    duration := case when coalesce(p_duration, 6) = -1 then 15 else greatest(4, least(15, coalesce(p_duration, 6))) end;
    rate_points := case resolution
      when '480P' then 8.268929 when '720P-SR' then 14.88408 when '1080P' then 40.0113
      when '1080P-SR' then 32.00904 when '1440P-SR' then 56.90496 when '4K' then 91.225764
      else 17.7828 end;
  elsif provider_id in ('video-3', 'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref') then
    duration := case when coalesce(p_duration, 6) = -1 then 30 else greatest(4, least(30, coalesce(p_duration, 6))) end;
    rate_points := case resolution
      when '480P' then 10.269725 when '720P-SR' then 16.123462 when '720P-ESR' then 18.485498
      when '1080P' then 43.469408 when '1080P-SR' then 29.815561 when '1080P-ESR' then 33.128398
      when '1080P-ESR & 60FPS' then 36.441248 when '1440P-SR' then 51.454793
      when '1440P-ESR' then 55.876573 when '4K-ESR' then 168.756088739 else 22.1160654 end;
    if resolution = '4K-ESR' then minimum_points := 1687.56088739; end if;
  else
    return null;
  end if;

  -- Atlas tables are in the legacy 0.10 CNY point denomination. Convert the
  -- complete job once, including the per-task operating allocation.
  upstream_cny := greatest(rate_points * duration, minimum_points) * 0.10 + 0.250;
  return public.quote_media_retail_credits_from_cny(upstream_cny);
end;
$$;

revoke all on function public.quote_minimax_h3_video_retail_credits(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.quote_ai_image_unit_credits(text, text) from public, anon, authenticated;
revoke all on function public.quote_ai_video_retail_credits(text, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.quote_minimax_h3_video_retail_credits(text, integer, integer, integer) to service_role;
grant execute on function public.quote_ai_image_unit_credits(text, text) to service_role;
grant execute on function public.quote_ai_video_retail_credits(text, text, integer, integer, boolean) to service_role;



-- Existing usage must report its recorded debit or reservation. Applying a
-- new quote to an old charge would inflate dashboards without a ledger debit.
create or replace function public.current_policy_ai_usage_credits(
  p_request_id uuid,
  p_kind text,
  p_provider_id text,
  p_resolution text,
  p_duration integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_kind text := lower(trim(coalesce(p_kind, '')));
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  normalized_duration integer := coalesce(p_duration, 6);
  video_job public.ai_video_jobs%rowtype;
  output_seconds integer;
  input_image_count integer;
  input_seconds integer;
  upstream_points numeric;
  recorded_usage public.ai_usage%rowtype;
begin
  select * into recorded_usage from public.ai_usage where request_id = p_request_id;
  if found then
    return case
      when recorded_usage.status = 'succeeded' then greatest(0, coalesce(recorded_usage.credits_charged, 0))
      when recorded_usage.status = 'reserved' then greatest(0, coalesce(recorded_usage.credits_reserved, 0))
      else 0
    end;
  end if;
  if normalized_kind = 'chat' then return 0; end if;

  if normalized_provider like 'topaz-%' then
    select tool_job.provider_cost into upstream_points
    from public.ai_tool_jobs tool_job
    where tool_job.request_id = p_request_id;
    if upstream_points is null then return null; end if;
    return public.quote_retail_credits_from_upstream_points(upstream_points * 0.15 * 7.3 * 10);
  end if;

  if normalized_provider in ('hunyuan3d', 'hyper3d', 'tripo3d') then
    select tool_job.provider_cost into upstream_points
    from public.ai_tool_jobs tool_job
    where tool_job.request_id = p_request_id;
    upstream_points := coalesce(upstream_points, case normalized_provider
      when 'hunyuan3d' then 80 when 'hyper3d' then 70 else 60 end);
    return public.quote_retail_credits_from_upstream_points(upstream_points / 100 * 7.3 * 10);
  end if;

  if normalized_kind = 'image' then
    return public.quote_ai_image_unit_credits(normalized_provider, normalized_resolution);
  end if;
  if normalized_kind <> 'video' then return null; end if;

  select * into video_job
  from public.ai_video_jobs
  where request_id = p_request_id;
  if found then
    normalized_provider := lower(coalesce(nullif(video_job.provider_id, ''), normalized_provider));
    normalized_resolution := lower(coalesce(nullif(video_job.resolution, ''), normalized_resolution));
    normalized_duration := coalesce(video_job.duration_seconds, normalized_duration);
    output_seconds := greatest(0, coalesce(
      video_job.provider_output_seconds,
      video_job.provider_total_seconds,
      normalized_duration,
      6
    ));
    input_seconds := greatest(0, coalesce(video_job.provider_input_seconds, 0));
    input_image_count := greatest(0, coalesce(video_job.provider_input_image_count, 0));
  else
    output_seconds := greatest(0, normalized_duration);
    input_seconds := 0;
    input_image_count := 0;
  end if;

  if normalized_provider in (
    'video-1', 'video-2', 'video-3',
    'atlas-kling-standard-silent', 'atlas-kling-standard-audio', 'atlas-kling-pro-silent', 'atlas-kling-pro-audio', 'atlas-kling-turbo-silent', 'atlas-kling-v3-4k-silent', 'atlas-kling-v3-4k-audio', 'atlas-kling-o3-4k-silent', 'atlas-kling-o3-4k-audio',
    'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
  ) then
    return public.quote_ai_video_retail_credits(
      normalized_provider, normalized_resolution, output_seconds,
      input_image_count, input_seconds > 0
    );
  end if;

  -- Retired historical routes remain visible in usage reports, but use the
  -- same 10% protection and 25% gross-margin helpers rather than old fixed
  -- retail prices.
  normalized_duration := case normalized_provider
    when 'video-4' then greatest(4, least(15, normalized_duration))
    when 'video-5' then greatest(2, least(12, normalized_duration))
    when 'video-6' then greatest(2, least(12, normalized_duration))
    when 'video-7' then greatest(2, least(12, normalized_duration))
    when 'video-8' then greatest(5, least(10, normalized_duration))
    when 'video-9' then greatest(5, least(10, normalized_duration))
    when 'video-10' then greatest(3, least(15, normalized_duration))
    when 'video-11' then greatest(3, least(15, normalized_duration))
    when 'video-12' then greatest(3, least(15, normalized_duration))
    when 'video-13' then greatest(3, least(15, normalized_duration))
    else null
  end;
  if normalized_duration is null then return null; end if;
  upstream_points := case normalized_provider
    when 'video-4' then case normalized_resolution when '480p' then 6.16465728 else 12.32931456 end * normalized_duration
    when 'video-5' then case when normalized_resolution = '480p' then 2 else 3 end * normalized_duration
    when 'video-6' then case normalized_resolution when '480p' then 2 when '720p' then 3 else 4 end * normalized_duration
    when 'video-7' then case when normalized_resolution = '480p' then 1.5 else 2.5 end * normalized_duration
    when 'video-8' then case when normalized_resolution = '1080p' then 1 else 0.5 end * normalized_duration
    when 'video-9' then 2 * normalized_duration
    when 'video-10' then 18.4 * normalized_duration
    when 'video-11' then 24.6 * normalized_duration
    when 'video-12' then 21.9 * normalized_duration
    when 'video-13' then 26.3 * normalized_duration
    else null
  end;
  if upstream_points is null then return null; end if;
  return public.quote_video_retail_credits_from_upstream_points(upstream_points);
end;
$$;

revoke all on function public.current_policy_ai_usage_credits(uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.current_policy_ai_usage_credits(uuid, text, text, text, integer)
  to service_role;



-- Async jobs must use the same video quote as the gateway and desktop. The
-- older provider-specific reservation branches remain for historical rows,
-- but must not be used for new jobs because they do not include the current
-- operating allocation consistently.
create or replace function public.start_ai_video_job(
  p_request_id uuid, p_user_id uuid, p_token_hash text, p_request_hash text,
  p_provider_id text, p_resolution text, p_duration integer,
  p_aspect_ratio text, p_expected_credits integer
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
      'ok', true, 'reason', 'already-started', 'requestId', existing_job.request_id,
      'status', existing_job.status, 'credits', existing_job.credits_reserved,
      'createdAt', existing_job.created_at, 'deadlineAt', existing_job.deadline_at
    );
  end if;

  reservation := public.reserve_ai_video_credits(
    p_user_id, 'video', normalized_provider, p_request_id,
    p_resolution, p_duration, p_expected_credits, 0, false
  );
  if coalesce((reservation->>'ok')::boolean, false) is not true then
    return reservation;
  end if;

  insert into public.ai_video_jobs (
    request_id, user_id, token_hash, request_hash, provider_id,
    resolution, duration_seconds, aspect_ratio, credits_reserved
  ) values (
    p_request_id, p_user_id, lower(trim(p_token_hash)), lower(trim(p_request_hash)),
    normalized_provider, upper(trim(coalesce(p_resolution, ''))), p_duration,
    trim(coalesce(p_aspect_ratio, '16:9')), coalesce((reservation->>'credits')::integer, 0)
  ) returning * into existing_job;

  return reservation || jsonb_build_object(
    'requestId', existing_job.request_id, 'status', existing_job.status,
    'createdAt', existing_job.created_at, 'deadlineAt', existing_job.deadline_at
  );
end;
$$;

-- Final settlement is never lower than the reservation. When provider usage
-- metadata is available, the same authoritative quote is used to top up a
-- reservation that was too small. This preserves the no-loss invariant while
-- keeping the operation idempotent through settle_ai_credits.
create or replace function public.settle_ai_video_download(
  p_user_id uuid, p_token_hash text, p_result_content_type text, p_result_bytes bigint
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
  output_seconds integer;
  input_seconds integer;
  input_image_count integer;
  actual_retail_credits integer;
  target_credits integer;
  top_up integer;
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')))
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;
  if job.status = 'succeeded' then
    return jsonb_build_object(
      'ok', true, 'reason', 'already-settled', 'status', job.status,
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

  target_credits := greatest(0, coalesce(job.credits_reserved, 0));
  if job.provider_id in (
    'video-1', 'video-2', 'video-3',
    'atlas-kling-standard-silent', 'atlas-kling-standard-audio', 'atlas-kling-pro-silent', 'atlas-kling-pro-audio', 'atlas-kling-turbo-silent', 'atlas-kling-v3-4k-silent', 'atlas-kling-v3-4k-audio', 'atlas-kling-o3-4k-silent', 'atlas-kling-o3-4k-audio',
    'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
  ) then
    output_seconds := greatest(0, coalesce(
      job.provider_output_seconds,
      job.provider_total_seconds,
      job.duration_seconds,
      6
    ));
    input_seconds := greatest(0, coalesce(job.provider_input_seconds, 0));
    input_image_count := greatest(0, coalesce(job.provider_input_image_count, 0));
    actual_retail_credits := public.quote_ai_video_retail_credits(
      job.provider_id,
      job.resolution,
      output_seconds,
      input_image_count,
      input_seconds > 0
    );
    target_credits := greatest(target_credits, coalesce(actual_retail_credits, 0));
  end if;

  top_up := greatest(0, target_credits - coalesce(usage_record.credits_reserved, 0));
  if top_up > 0 then
    if account_record.balance - account_record.reserved < top_up then
      return jsonb_build_object(
        'ok', false, 'reason', 'insufficient-credits',
        'creditsEstimated', job.credits_reserved,
        'creditsRequired', target_credits,
        'creditsCharged', 0
      );
    end if;
    update public.ai_credit_accounts
    set reserved = reserved + top_up, updated_at = now()
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
        'kind', 'video', 'providerId', job.provider_id,
        'actualRetailCredits', target_credits, 'pricingVersion', '202609060001'
      )
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  settlement := public.settle_ai_credits(
    job.request_id, 'succeeded', coalesce(job.provider_duration_ms, 0)
  );
  if coalesce((settlement->>'ok')::boolean, false) is not true
     or coalesce(settlement->>'status', '') <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'video credit settlement failed';
  end if;

  update public.ai_video_jobs
  set status = 'succeeded',
      result_content_type = nullif(left(trim(coalesce(p_result_content_type, 'video/mp4')), 128), ''),
      result_bytes = greatest(0, coalesce(p_result_bytes, 0)),
      credits_charged = coalesce((settlement->>'creditsCharged')::integer, target_credits),
      error_code = null, error_message = null, completed_at = now(), updated_at = now()
  where request_id = job.request_id
  returning * into job;

  return jsonb_build_object(
    'ok', true, 'reason', 'settled', 'status', job.status,
    'creditsEstimated', job.credits_reserved, 'creditsCharged', job.credits_charged,
    'providerTotalSeconds', job.provider_total_seconds,
    'providerInputSeconds', job.provider_input_seconds,
    'providerOutputSeconds', job.provider_output_seconds,
    'providerInputImageCount', job.provider_input_image_count
  );
end;
$$;

revoke all on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer)
  to service_role;
revoke all on function public.settle_ai_video_download(uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.settle_ai_video_download(uuid, text, text, bigint)
  to service_role;




create or replace function public.reserve_ai_video_credits(
  p_user_id uuid,
  p_kind text,
  p_provider_id text,
  p_request_id uuid,
  p_resolution text default null,
  p_duration integer default null,
  p_expected_credits integer default null,
  p_reference_image_count integer default 0,
  p_has_reference_video boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'video'
     or normalized_provider not in ('video-1', 'video-2', 'video-3', 'atlas-kling-standard-silent', 'atlas-kling-standard-audio', 'atlas-kling-pro-silent', 'atlas-kling-pro-audio', 'atlas-kling-turbo-silent', 'atlas-kling-v3-4k-silent', 'atlas-kling-v3-4k-audio', 'atlas-kling-o3-4k-silent', 'atlas-kling-o3-4k-audio') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  quoted_credits := public.quote_ai_video_retail_credits(
    normalized_provider, p_resolution, p_duration,
    p_reference_image_count, p_has_reference_video
  );
  if quoted_credits is null then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  -- A higher gateway estimate is conservative input-media protection. Never
  -- lower it during reservation, because a fallback may cost more.
  if p_expected_credits is not null and p_expected_credits > quoted_credits then
    return public.reserve_priced_ai_credits_internal(
      p_user_id, 'video', normalized_provider, p_request_id,
      upper(trim(coalesce(p_resolution, ''))), p_duration,
      p_expected_credits, p_expected_credits
    );
  end if;
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'video', normalized_provider, p_request_id,
    upper(trim(coalesce(p_resolution, ''))), p_duration,
    p_expected_credits, quoted_credits
  );
end;
$;

revoke all on function public.reserve_ai_video_credits(uuid, text, text, uuid, text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.reserve_ai_video_credits(uuid, text, text, uuid, text, integer, integer, integer, boolean) to service_role;



NOTIFY pgrst, 'reload schema';
COMMIT;
