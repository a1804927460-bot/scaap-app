-- Segmented retail policy, effective for newly reserved work only.
-- 1000 app credits = CNY 70. Every upstream cost receives a 10% buffer.
-- Images and chargeable capsule generators retain a 10% gross margin; video
-- retains a 20% gross margin. Chaser Pro stays owner-fixed at 5/8 credits.

create or replace function public.quote_retail_credits_from_upstream_points(
  p_upstream_points numeric
)
returns integer
language sql
immutable
set search_path = public
as $$
  select ceil(
    greatest(0, coalesce(p_upstream_points, 0))
      * (10.0 / 7.0) * 1.10 / 0.90
  )::integer
$$;

create or replace function public.quote_video_retail_credits_from_upstream_points(
  p_upstream_points numeric
)
returns integer
language sql
immutable
set search_path = public
as $$
  select ceil(
    greatest(0, coalesce(p_upstream_points, 0))
      * (10.0 / 7.0) * 1.10 / 0.80
  )::integer
$$;

create or replace function public.quote_seedance_retail_credits(
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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := upper(trim(coalesce(p_resolution, '')));
  normalized_duration integer;
  rate_per_second numeric;
begin
  if normalized_provider = 'video-2' then
    normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
      else greatest(4, least(15, coalesce(p_duration, 6))) end;
    rate_per_second := case normalized_resolution
      when '480P' then 8.268929 when '720P' then 17.7828
      when '720P-SR' then 14.88408 when '1080P' then 40.0113
      when '1080P-SR' then 32.00904 when '1440P-SR' then 56.90496
      when '4K' then 91.225764 else null end;
  elsif normalized_provider = 'video-3' then
    normalized_duration := case when coalesce(p_duration, 6) = -1 then 30
      else greatest(4, least(30, coalesce(p_duration, 6))) end;
    rate_per_second := case normalized_resolution
      when '480P' then 10.269725 when '720P' then 22.1160654
      when '720P-SR' then 16.123462 when '720P-ESR' then 18.485498
      when '1080P' then 43.469408 when '1080P-SR' then 29.815561
      when '1080P-ESR' then 33.128398 when '1080P-ESR & 60FPS' then 36.441248
      when '1440P-SR' then 51.454793 when '1440P-ESR' then 55.876573
      when '4K-ESR' then 168.756088739 else null end;
  elsif normalized_provider = 'video-4' then
    normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
      else greatest(4, least(15, coalesce(p_duration, 6))) end;
    rate_per_second := case normalized_resolution
      when '480P' then 6.16465728 when '720P' then 12.32931456 else null end;
  else
    return null;
  end if;

  if rate_per_second is null then return null; end if;
  return public.quote_video_retail_credits_from_upstream_points(
    case when normalized_provider = 'video-3' and normalized_resolution = '4K-ESR'
      then greatest(rate_per_second * normalized_duration, 1687.56088739)
      else rate_per_second * normalized_duration end
  );
end;
$$;

create or replace function public.reserve_atlas_catalog_credits(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text default null, p_duration integer default null,
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
  normalized_resolution text := upper(trim(coalesce(p_resolution, '')));
  normalized_duration integer;
  normalized_quality text;
  normalized_image_resolution text;
  separator_position integer;
  rate_per_second numeric;
  upstream_points numeric;
  quoted_credits integer;
begin
  if normalized_kind = 'image'
     and normalized_provider in ('image-6', 'atlas-image-gpt2', 'atlas-image-gpt2-edit') then
    separator_position := position(':' in lower(trim(coalesce(p_resolution, ''))));
    if separator_position > 0 then
      normalized_quality := split_part(lower(trim(p_resolution)), ':', 1);
      normalized_image_resolution := split_part(lower(trim(p_resolution)), ':', 2);
    else
      normalized_quality := lower(trim(coalesce(p_resolution, 'auto')));
      normalized_image_resolution := '1k';
    end if;
    if normalized_quality not in ('low', 'medium', 'high', 'auto') then normalized_quality := 'auto'; end if;
    if normalized_image_resolution not in ('1k', '2k', '4k') then normalized_image_resolution := '1k'; end if;
    normalized_resolution := normalized_quality || ':' || normalized_image_resolution;

    -- image-6 can become an edit request when references are attached. Quote
    -- its edit ceiling so an input added after selection cannot undercharge.
    if normalized_provider = 'atlas-image-gpt2' then
      upstream_points := case normalized_quality
        when 'low' then case normalized_image_resolution when '1k' then 1 else 2 end
        when 'high' then case normalized_image_resolution when '1k' then 16 else 32 end
        else case normalized_image_resolution when '1k' then 5 else 9 end
      end;
    else
      upstream_points := case normalized_quality
        when 'low' then case normalized_image_resolution when '1k' then 2 else 3 end
        when 'high' then case normalized_image_resolution when '1k' then 17 else 33 end
        else case normalized_image_resolution when '1k' then 6 else 10 end
      end;
    end if;
    quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  elsif normalized_kind = 'video'
        and normalized_provider in (
          'video-2', 'video-3',
          'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
          'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
        ) then
    if normalized_provider in ('video-2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref') then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then 8.268929 when '720P-SR' then 14.88408
        when '1080P' then 40.0113 when '1080P-SR' then 32.00904
        when '1440P-SR' then 56.90496 when '4K' then 91.225764
        else 17.7828 end;
    else
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 30
        else greatest(4, least(30, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then 10.269725 when '720P-SR' then 16.123462
        when '720P-ESR' then 18.485498 when '1080P' then 43.469408
        when '1080P-SR' then 29.815561 when '1080P-ESR' then 33.128398
        when '1080P-ESR & 60FPS' then 36.441248 when '1440P-SR' then 51.454793
        when '1440P-ESR' then 55.876573 when '4K-ESR' then 168.756088739
        else 22.1160654 end;
    end if;
    quoted_credits := public.quote_video_retail_credits_from_upstream_points(
      case when normalized_resolution = '4K-ESR'
        then greatest(rate_per_second * normalized_duration, 1687.56088739)
        else rate_per_second * normalized_duration end
    );
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, case when normalized_kind = 'video' then normalized_duration else null end,
    p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_302_catalog_credits(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text default null, p_duration integer default null,
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
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  normalized_duration integer;
  upstream_points numeric;
  quoted_credits integer;
begin
  if normalized_kind = 'image' then
    if normalized_provider = 'image-3' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 8 else 5 end;
    elsif normalized_provider = 'image-10' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      upstream_points := case normalized_resolution when '4k' then 7 else 4 end;
    elsif normalized_provider = 'image-11' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      upstream_points := case normalized_resolution when '4k' then 4 else 3 end;
    elsif normalized_provider = 'image-12' then
      if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '1k'; end if;
      upstream_points := case normalized_resolution when '2k' then 3 when '4k' then 4 else 2 end;
    elsif normalized_provider in ('image-13', 'image-14') then
      normalized_resolution := null; upstream_points := 2;
    elsif normalized_provider = 'image-15' then
      if normalized_resolution not in ('1k', '2k') then normalized_resolution := '1k'; end if;
      upstream_points := case normalized_resolution when '2k' then 4 else 3 end;
    elsif normalized_provider = 'image-16' then
      if normalized_resolution not in ('512x512', '1024x1024') then normalized_resolution := '512x512'; end if;
      upstream_points := 2;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    if quoted_credits is null then
      quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider in ('video-10', 'video-11', 'video-12', 'video-13') then
      return public.reserve_kling_video_credits(
        p_user_id, normalized_kind, normalized_provider, p_request_id,
        p_resolution, p_duration, p_expected_credits
      );
    elsif normalized_provider = 'video-4' then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      normalized_resolution := upper(trim(coalesce(p_resolution, '')));
      quoted_credits := public.quote_seedance_retail_credits(
        normalized_provider, normalized_resolution, normalized_duration
      );
      if quoted_credits is null then return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed'); end if;
    elsif normalized_provider in ('video-5', 'video-6', 'video-7', 'video-8', 'video-9') then
      normalized_duration := case when normalized_provider in ('video-5', 'video-6', 'video-7')
        then greatest(2, least(12, coalesce(p_duration, 6)))
        else greatest(5, least(10, coalesce(p_duration, 6))) end;
      if normalized_provider = 'video-5' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
        upstream_points := (case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration;
      elsif normalized_provider = 'video-6' then
        normalized_resolution := case upper(trim(coalesce(p_resolution, '')))
          when '480P' then '480P' when '720P' then '720P' else '1080P' end;
        upstream_points := (case normalized_resolution when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration;
      elsif normalized_provider = 'video-7' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, '')))= '480P' then '480P' else '720P' end;
        upstream_points := (case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration;
      elsif normalized_provider = 'video-8' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '1080P' then '1080P' else '720P' end;
        upstream_points := (case normalized_resolution when '1080P' then 1 else 0.5 end) * normalized_duration;
      else
        normalized_resolution := '1080P'; upstream_points := 2 * normalized_duration;
      end if;
      quoted_credits := public.quote_video_retail_credits_from_upstream_points(upstream_points);
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_minimax_video_credits(
  p_user_id uuid, p_request_id uuid, p_resolution text,
  p_duration integer, p_expected_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_resolution text := case when upper(trim(coalesce(p_resolution, ''))) = '2K' then '2K' else '768P' end;
  normalized_duration integer := case when coalesce(p_duration, 6) = -1 then 15
    else greatest(4, least(15, coalesce(p_duration, 6))) end;
  output_credits integer;
begin
  -- CNY 0.50/0.80 per second with 10% protection and 20% video gross margin.
  output_credits := (case normalized_resolution when '2K' then 16 else 10 end) * normalized_duration;
  if p_expected_credits is null or p_expected_credits < output_credits then
    return jsonb_build_object('ok', false, 'reason', 'pricing-mismatch', 'credits', output_credits);
  end if;
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'video', 'video-1', p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, p_expected_credits
  );
end;
$$;

create or replace function public.reserve_kling_video_credits(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text default null, p_duration integer default null,
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
  upstream_points numeric;
  quoted_credits integer;
begin
  if normalized_kind <> 'video' then return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed'); end if;
  if normalized_provider = 'video-10' then
    normalized_resolution := '720P'; normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_points := 18.4 * normalized_duration;
  elsif normalized_provider = 'video-11' then
    normalized_resolution := '1080P'; normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_points := 24.6 * normalized_duration;
  elsif normalized_provider = 'video-12' then
    normalized_resolution := '720P'; normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_points := 21.9 * normalized_duration;
  elsif normalized_provider = 'video-13' then
    normalized_resolution := '1080P'; normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_points := 26.3 * normalized_duration;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  quoted_credits := public.quote_video_retail_credits_from_upstream_points(upstream_points);
  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

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
  select * into existing_job from public.ai_video_jobs where request_id = p_request_id for update;
  if found then
    if existing_job.user_id <> p_user_id
       or existing_job.token_hash <> lower(trim(p_token_hash))
       or existing_job.request_hash <> lower(trim(p_request_hash))
       or existing_job.provider_id <> normalized_provider then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object('ok', true, 'reason', 'already-started',
      'requestId', existing_job.request_id, 'status', existing_job.status,
      'credits', existing_job.credits_reserved, 'createdAt', existing_job.created_at,
      'deadlineAt', existing_job.deadline_at);
  end if;

  if normalized_provider = 'video-1' then
    reservation := public.reserve_minimax_video_credits(p_user_id, p_request_id, p_resolution, p_duration, p_expected_credits);
  elsif normalized_provider in ('video-2', 'video-3', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref') then
    reservation := public.reserve_atlas_catalog_credits(p_user_id, 'video', normalized_provider, p_request_id,
      p_resolution, p_duration, p_expected_credits);
  elsif normalized_provider in ('video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9') then
    reservation := public.reserve_302_catalog_credits(p_user_id, 'video', normalized_provider, p_request_id,
      p_resolution, p_duration, p_expected_credits);
  elsif normalized_provider in ('video-10', 'video-11', 'video-12', 'video-13') then
    reservation := public.reserve_kling_video_credits(p_user_id, 'video', normalized_provider, p_request_id,
      p_resolution, p_duration, p_expected_credits);
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if coalesce((reservation->>'ok')::boolean, false) is not true then return reservation; end if;

  insert into public.ai_video_jobs (
    request_id, user_id, token_hash, request_hash, provider_id,
    resolution, duration_seconds, aspect_ratio, credits_reserved
  ) values (
    p_request_id, p_user_id, lower(trim(p_token_hash)), lower(trim(p_request_hash)),
    normalized_provider, upper(trim(p_resolution)), p_duration,
    trim(p_aspect_ratio), coalesce((reservation->>'credits')::integer, 0)
  ) returning * into existing_job;
  return reservation || jsonb_build_object(
    'requestId', existing_job.request_id, 'status', existing_job.status,
    'createdAt', existing_job.created_at, 'deadlineAt', existing_job.deadline_at
  );
end;
$$;

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
  billable_seconds integer;
  image_count integer;
  upstream_cny numeric;
  actual_retail_credits integer;
  target_credits integer;
  top_up integer;
begin
  select * into job from public.ai_video_jobs
  where user_id = p_user_id and token_hash = lower(trim(coalesce(p_token_hash, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if job.status = 'succeeded' then
    return jsonb_build_object('ok', true, 'reason', 'already-settled', 'status', job.status,
      'creditsEstimated', job.credits_reserved, 'creditsCharged', coalesce(job.credits_charged, job.credits_reserved));
  end if;
  if job.status <> 'ready' then return jsonb_build_object('ok', false, 'reason', 'not-ready', 'status', job.status); end if;

  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  select * into usage_record from public.ai_usage where request_id = job.request_id for update;
  if usage_record.status <> 'reserved' then return jsonb_build_object('ok', false, 'reason', 'usage-not-reserved'); end if;

  target_credits := job.credits_reserved;
  if job.provider_id = 'video-1' then
    billable_seconds := case
      when job.provider_output_seconds is not null or job.provider_input_seconds is not null
        then coalesce(job.provider_output_seconds, job.duration_seconds) + coalesce(job.provider_input_seconds, 0)
      when job.provider_total_seconds is not null then job.provider_total_seconds
      else job.duration_seconds end;
    image_count := greatest(0, coalesce(job.provider_input_image_count, 0));
    upstream_cny := (case when upper(job.resolution) = '2K' then 0.80 else 0.50 end)
      * greatest(0, billable_seconds) + 0.20 * greatest(0, image_count - 5);
    actual_retail_credits := ceil(upstream_cny * (1000.0 / 70.0) * 1.10 / 0.80)::integer;
    target_credits := greatest(target_credits, actual_retail_credits);
  end if;

  top_up := greatest(0, target_credits - usage_record.credits_reserved);
  if top_up > 0 then
    if account_record.balance - account_record.reserved < top_up then
      settlement := public.settle_ai_credits(job.request_id, 'failed', coalesce(job.provider_duration_ms, 0));
      update public.ai_video_jobs
      set status = 'failed', result_url = null, result_content_type = null, result_bytes = null,
          credits_charged = 0, error_code = 'insufficient-credits',
          error_message = 'The actual provider cost exceeded the available point balance.',
          completed_at = now(), updated_at = now()
      where request_id = job.request_id;
      return jsonb_build_object('ok', false, 'reason', 'insufficient-credits',
        'creditsEstimated', job.credits_reserved, 'creditsCharged', 0, 'creditsReleased', job.credits_reserved);
    end if;
    update public.ai_credit_accounts set reserved = reserved + top_up, updated_at = now()
    where user_id = p_user_id returning * into account_record;
    update public.ai_usage set credits_reserved = credits_reserved + top_up
    where request_id = job.request_id returning * into usage_record;
    insert into public.ai_credit_ledger (
      user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
      request_id, reference_id, idempotency_key, metadata
    ) values (
      p_user_id, 'reserve', 0, top_up, account_record.balance, account_record.reserved,
      job.request_id, job.request_id::text, 'video-topup:' || job.request_id::text,
      jsonb_build_object('kind', 'video', 'providerId', job.provider_id, 'actualRetailCredits', target_credits)
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  settlement := public.settle_ai_credits(job.request_id, 'succeeded', coalesce(job.provider_duration_ms, 0));
  if coalesce((settlement->>'ok')::boolean, false) is not true
     or coalesce(settlement->>'status', '') <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'video credit settlement failed';
  end if;
  update public.ai_video_jobs
  set status = 'succeeded',
      result_content_type = nullif(left(trim(coalesce(p_result_content_type, 'video/mp4')), 128), ''),
      result_bytes = greatest(0, p_result_bytes),
      credits_charged = coalesce((settlement->>'creditsCharged')::integer, target_credits),
      error_code = null, error_message = null, completed_at = now(), updated_at = now()
  where request_id = job.request_id returning * into job;
  return jsonb_build_object('ok', true, 'reason', 'settled', 'status', job.status,
    'creditsEstimated', job.credits_reserved, 'creditsCharged', job.credits_charged,
    'providerTotalSeconds', job.provider_total_seconds,
    'providerInputSeconds', job.provider_input_seconds,
    'providerOutputSeconds', job.provider_output_seconds,
    'providerInputImageCount', job.provider_input_image_count);
end;
$$;

revoke all on function public.quote_retail_credits_from_upstream_points(numeric) from public, anon, authenticated;
grant execute on function public.quote_retail_credits_from_upstream_points(numeric) to service_role;
revoke all on function public.quote_video_retail_credits_from_upstream_points(numeric) from public, anon, authenticated;
grant execute on function public.quote_video_retail_credits_from_upstream_points(numeric) to service_role;
revoke all on function public.quote_seedance_retail_credits(text, text, integer) from public, anon, authenticated;
grant execute on function public.quote_seedance_retail_credits(text, text, integer) to service_role;
revoke all on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_minimax_video_credits(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_minimax_video_credits(uuid, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_kling_video_credits(uuid, text, text, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_kling_video_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.start_ai_video_job(uuid, uuid, text, text, text, text, integer, text, integer) to service_role;
revoke all on function public.settle_ai_video_download(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.settle_ai_video_download(uuid, text, text, bigint) to service_role;

notify pgrst, 'reload schema';
