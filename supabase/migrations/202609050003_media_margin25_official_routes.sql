-- Reprice newly reserved media at upstream cost + 10% cost protection,
-- then a 25% gross margin: retail = cost * 1.10 / 0.75.
-- Existing balances, settled usage, and ledger rows are immutable.

create or replace function public.quote_media_retail_credits_from_cny(p_cost_cny numeric)
returns integer
language sql
immutable
set search_path = public
as $$
  select ceil(greatest(0, coalesce(p_cost_cny, 0)) * (1000.0 / 70.0) * 1.10 / 0.75)::integer
$$;

create or replace function public.quote_media_retail_credits_from_usd(p_cost_usd numeric)
returns integer
language sql
immutable
set search_path = public
as $$
  select public.quote_media_retail_credits_from_cny(greatest(0, coalesce(p_cost_usd, 0)) * 7.3)
$$;

create or replace function public.quote_retail_credits_from_upstream_points(p_upstream_points numeric)
returns integer
language sql
immutable
set search_path = public
as $$
  select ceil(greatest(0, coalesce(p_upstream_points, 0)) * (10.0 / 7.0) * 1.10 / 0.75)::integer
$$;

create or replace function public.quote_video_retail_credits_from_upstream_points(p_upstream_points numeric)
returns integer
language sql
immutable
set search_path = public
as $$
  select public.quote_retail_credits_from_upstream_points(p_upstream_points)
$$;

create or replace function public.quote_image_operating_cost_upstream_points()
returns numeric
language sql
immutable
set search_path = public
as $$ select 0.013 * (1000.0 / 70.0) $$;

create or replace function public.quote_video_operating_cost_upstream_points()
returns numeric
language sql
immutable
set search_path = public
as $$ select 0.250 * (1000.0 / 70.0) $$;

create or replace function public.quote_minimax_h3_video_retail_credits(
  p_resolution text,
  p_output_seconds integer,
  p_input_seconds integer default 0,
  p_input_image_count integer default 0
)
returns integer
language sql
immutable
set search_path = public
as $$
  select (
    public.quote_media_retail_credits_from_usd(
      (case when upper(trim(coalesce(p_resolution, ''))) = '2K' then 0.1825 else 0.1125 end)
    ) * greatest(0, coalesce(p_output_seconds, 0) + coalesce(p_input_seconds, 0))
    + public.quote_media_retail_credits_from_usd(0.055)
      * greatest(0, coalesce(p_input_image_count, 0) - 5)
    + public.quote_media_retail_credits_from_cny(0.250)
  )::integer
$$;

create or replace function public.quote_ai_image_unit_credits(
  p_provider_id text,
  p_resolution text default null
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  provider_id text := lower(trim(coalesce(p_provider_id, '')));
  supplied_resolution text := lower(trim(coalesce(p_resolution, '')));
  quality text;
  image_resolution text;
  upstream_usd numeric;
begin
  if provider_id = 'image-1' then
    upstream_usd := case supplied_resolution
      when '1k' then 0.165 when '2k' then 0.165 when '4k' then 0.330 else 0.165 end;
    return public.quote_media_retail_credits_from_cny(upstream_usd * 7.3 + 0.013);
  end if;
  if provider_id = 'image-2' then
    upstream_usd := case supplied_resolution
      when '1k' then 0.077 when '2k' then 0.1155 when '4k' then 0.154 else 0.1155 end;
    return public.quote_media_retail_credits_from_cny(upstream_usd * 7.3 + 0.013);
  end if;
  if provider_id = 'image-6' then
    quality := split_part(supplied_resolution || ':medium:1k', ':', 1);
    image_resolution := split_part(supplied_resolution || ':medium:1k', ':', 2);
    if quality not in ('low', 'medium', 'high') then quality := 'medium'; end if;
    if image_resolution not in ('1k', '2k', '4k') then image_resolution := '1k'; end if;
    upstream_usd := case quality
      when 'low' then case image_resolution when '1k' then 0.022 when '2k' then 0.029 else 0.036 end
      when 'high' then case image_resolution when '1k' then 0.330 when '2k' then 0.350 else 0.620 end
      else case image_resolution when '1k' then 0.092 when '2k' then 0.100 else 0.170 end
    end;
    return public.quote_media_retail_credits_from_cny(upstream_usd * 7.3 + 0.013);
  end if;
  return case provider_id
    when 'image-3' then case when supplied_resolution = '4k' then 8 else 5 end
    when 'image-4' then public.quote_media_retail_credits_from_upstream_points(2 + 0.013 * 10)
    when 'image-5' then public.quote_media_retail_credits_from_upstream_points(2 + 0.013 * 10)
    when 'image-17' then public.quote_media_retail_credits_from_usd(case when supplied_resolution = '2k' then 0.32 else 0.08 end)
    when 'image-18' then public.quote_media_retail_credits_from_usd(case when supplied_resolution = '2k' then 0.32 else 0.08 end)
    else null
  end;
end;
$$;

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
  reference_images integer := greatest(0, coalesce(p_reference_image_count, 0));
begin
  if provider_id = 'video-1' then
    duration := case when coalesce(p_duration, 6) = -1 then 15 else greatest(4, least(15, coalesce(p_duration, 6))) end;
    return public.quote_minimax_h3_video_retail_credits(
      case when resolution = '2K' then '2K' else '768P' end, duration,
      case when coalesce(p_has_reference_video, false) then 15 else 0 end, reference_images);
  end if;
  if provider_id = 'video-2' then
    duration := case when coalesce(p_duration, 6) = -1 then 15 else greatest(4, least(15, coalesce(p_duration, 6))) end;
    rate_points := case resolution
      when '480P' then 8.268929 when '720P-SR' then 14.88408 when '1080P' then 40.0113
      when '1080P-SR' then 32.00904 when '1440P-SR' then 56.90496 when '4K' then 91.225764
      else 17.7828 end;
  elsif provider_id = 'video-3' then
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
  return public.quote_media_retail_credits_from_cny(
    greatest(rate_points * duration * (10.0 / 7.0), minimum_points * (10.0 / 7.0))
      * (70.0 / 1000.0) + 0.250
  );
end;
$$;

revoke all on function public.quote_media_retail_credits_from_cny(numeric) from public, anon, authenticated;
revoke all on function public.quote_media_retail_credits_from_usd(numeric) from public, anon, authenticated;
grant execute on function public.quote_media_retail_credits_from_cny(numeric) to service_role;
grant execute on function public.quote_media_retail_credits_from_usd(numeric) to service_role;
notify pgrst, 'reload schema';

-- The worker must persist the provider result before exposing it as ready.
-- This overload keeps the older eight-argument RPC available for legacy
-- retries while making new deliveries atomic with their storage reference.
drop function if exists public.record_ai_video_provider_result(
  uuid, uuid, text, text, text, bigint, integer, integer, integer, integer, integer
);

create or replace function public.record_ai_video_provider_result(
  p_request_id uuid,
  p_lease_token uuid,
  p_result_url text,
  p_storage_ref text,
  p_result_content_type text,
  p_result_bytes bigint,
  p_total_seconds integer,
  p_input_seconds integer,
  p_output_seconds integer,
  p_input_image_count integer,
  p_duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
  normalized_storage text := trim(coalesce(p_storage_ref, ''));
begin
  if trim(coalesce(p_result_url, '')) !~* '^https://'
     or normalized_storage !~* '^storage://messs-ai-video-results/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(mp4|webm|mov)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-result');
  end if;
  select * into job from public.ai_video_jobs where request_id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown-request'); end if;
  if normalized_storage !~* ('^storage://messs-ai-video-results/' || lower(job.user_id::text) || '/' || lower(job.request_id::text) || '\\.(mp4|webm|mov)$') then
    return jsonb_build_object('ok', false, 'reason', 'storage-owner-mismatch');
  end if;
  if job.status in ('ready', 'succeeded') then
    return jsonb_build_object('ok', true, 'reason', 'already-recorded', 'requestId', job.request_id, 'status', job.status);
  end if;
  if job.status = 'failed' then return jsonb_build_object('ok', false, 'reason', 'already-failed'); end if;
  if job.lease_token is null or job.lease_token is distinct from p_lease_token or job.leased_until <= now() then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;
  update public.ai_video_jobs
  set status = 'ready',
      result_url = trim(p_result_url),
      result_storage_ref = normalized_storage,
      result_content_type = nullif(left(trim(coalesce(p_result_content_type, 'video/mp4')), 128), ''),
      result_bytes = greatest(0, coalesce(p_result_bytes, 0)),
      provider_total_seconds = case when p_total_seconds >= 0 then p_total_seconds else null end,
      provider_input_seconds = case when p_input_seconds >= 0 then p_input_seconds else null end,
      provider_output_seconds = case when p_output_seconds >= 0 then p_output_seconds else null end,
      provider_input_image_count = case when p_input_image_count >= 0 then p_input_image_count else null end,
      provider_duration_ms = greatest(0, coalesce(p_duration_ms, 0)),
      error_code = null, error_message = null,
      lease_token = null, leased_by = null, leased_until = null, updated_at = now()
  where request_id = p_request_id
  returning * into job;
  return jsonb_build_object(
    'ok', true, 'reason', 'stored', 'requestId', job.request_id,
    'status', job.status, 'creditsEstimated', job.credits_reserved,
    'storageRef', job.result_storage_ref
  );
end;
$$;

revoke all on function public.record_ai_video_provider_result(
  uuid, uuid, text, text, text, bigint, integer, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_ai_video_provider_result(
  uuid, uuid, text, text, text, bigint, integer, integer, integer, integer, integer
) to service_role;

-- Include the owner in worker claims so the server can address the private
-- storage object without ever exposing user data to the provider.
drop function if exists public.claim_due_ai_video_jobs(text, integer, integer);
create or replace function public.claim_due_ai_video_jobs(
  p_worker_id text,
  p_limit integer default 4,
  p_lease_seconds integer default 60
)
returns table (
  request_id uuid,
  user_id uuid,
  provider_id text,
  provider_task_id text,
  status text,
  attempt_count integer,
  lease_token uuid,
  deadline_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'invalid worker id';
  end if;
  return query
  with due as (
    select job.request_id
    from public.ai_video_jobs as job
    where job.status in ('submitted', 'polling')
      and job.provider_task_id is not null
      and job.next_poll_at <= now()
      and (job.leased_until is null or job.leased_until <= now())
    order by job.next_poll_at, job.created_at
    for update skip locked
    limit greatest(1, least(25, coalesce(p_limit, 4)))
  )
  update public.ai_video_jobs as job
  set lease_token = gen_random_uuid(),
      leased_by = left(trim(p_worker_id), 128),
      leased_until = now() + make_interval(secs => greatest(10, least(300, coalesce(p_lease_seconds, 60)))),
      updated_at = now()
  from due
  where job.request_id = due.request_id
  returning job.request_id, job.user_id, job.provider_id, job.provider_task_id,
    job.status, job.attempt_count, job.lease_token, job.deadline_at, job.created_at;
end;
$$;

grant execute on function public.claim_due_ai_video_jobs(text, integer, integer) to service_role;
notify pgrst, 'reload schema';
