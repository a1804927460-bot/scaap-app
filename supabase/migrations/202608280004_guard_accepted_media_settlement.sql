-- Keep accepted media tasks recoverable until their result is delivered.
-- This migration only tightens existing RPC state transitions; public API
-- routes and request payloads remain unchanged.

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
  result_reference text := trim(coalesce(p_result_url, ''));
  internal_reference text;
begin
  if p_user_id is null or p_request_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid-request');
  end if;

  -- The gateway stores durable image bytes under this exact user/request key.
  -- Accepting only that reference prevents a caller from registering an
  -- arbitrary storage object while still allowing normal HTTPS provider URLs.
  internal_reference := '^storage://messs-ai-image-results/'
    || lower(p_user_id::text) || '/' || lower(p_request_id::text)
    || '[.](png|jpg|webp|gif|avif)$';
  if result_reference !~* '^https://'
     and result_reference !~* internal_reference then
    return jsonb_build_object('ok', false, 'reason', 'invalid-result-url');
  end if;

  select * into job from public.ai_image_jobs
  where user_id = p_user_id and request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if job.status = 'failed' then
    return jsonb_build_object('ok', false, 'reason', 'already-failed');
  end if;
  if job.status = 'ready' then
    return jsonb_build_object(
      'ok', true, 'reason', 'already-recorded',
      'requestId', job.request_id, 'status', job.status,
      'resultUrl', job.result_url, 'creditsReserved', job.credits_reserved
    );
  end if;

  update public.ai_image_jobs
  set status = 'ready',
      result_url = left(result_reference, 2000),
      updated_at = now(),
      error_code = null,
      error_message = null
  where request_id = p_request_id
  returning * into job;

  return jsonb_build_object(
    'ok', true, 'reason', 'ready',
    'requestId', job.request_id, 'userId', job.user_id,
    'requestHash', job.request_hash, 'providerId', job.provider_id,
    'providerTaskId', job.provider_task_id, 'pollUrl', job.poll_url,
    'resultUrl', job.result_url, 'status', job.status,
    'creditsReserved', job.credits_reserved, 'deadlineAt', job.deadline_at
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
begin
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id
    and token_hash = lower(trim(coalesce(p_token_hash, '')))
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not-found'); end if;
  if job.status = 'succeeded' then
    return jsonb_build_object(
      'ok', true, 'reason', 'already-settled', 'status', 'succeeded',
      'creditsEstimated', job.credits_reserved,
      'creditsCharged', coalesce(job.credits_charged, job.credits_reserved)
    );
  end if;
  if job.status = 'failed' then
    return jsonb_build_object('ok', true, 'reason', 'already-failed', 'status', 'failed', 'creditsCharged', 0);
  end if;

  -- A local download failure does not prove that the provider task failed.
  -- Keep the result URL and reservation so the same token can be retried.
  return jsonb_build_object(
    'ok', false,
    'reason', 'delivery-pending',
    'status', job.status,
    'creditsEstimated', job.credits_reserved,
    'creditsCharged', 0
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
      -- Do not release the original reservation or erase the ready result.
      -- The user can add points and confirm the same task token later.
      return jsonb_build_object(
        'ok', false,
        'reason', 'insufficient-credits',
        'status', 'ready',
        'creditsEstimated', job.credits_reserved,
        'creditsCharged', 0,
        'creditsHeld', job.credits_reserved,
        'creditsRequired', target_credits
      );
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

revoke all on function public.record_ai_image_provider_result(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_ai_video_download(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.settle_ai_video_download(uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.record_ai_image_provider_result(uuid, uuid, text) to service_role;
grant execute on function public.fail_ai_video_download(uuid, text, text, text) to service_role;
grant execute on function public.settle_ai_video_download(uuid, text, text, bigint) to service_role;

notify pgrst, 'reload schema';
