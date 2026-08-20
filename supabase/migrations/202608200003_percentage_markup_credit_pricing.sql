-- Reprice every paid AI route at verified upstream cost plus 20%.
-- 10 app points = CNY 1, 1 PTC = USD 1, settlement FX = CNY 7.3/USD.
-- There is no fixed per-request profit, employee tier, or video minimum.

create or replace function public.quote_retail_credits_from_upstream_points(
  p_upstream_points numeric
)
returns integer
language sql
immutable
set search_path = public
as $$
  select ceil(greatest(0, coalesce(p_upstream_points, 0)) * 1.20)::integer
$$;

create or replace function public.apply_ai_pricing_tier(
  p_user_id uuid, p_standard_credits integer, p_upstream_credits numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- All accounts use one public price. Keep the legacy signature because old
  -- RPCs call it, but calculate from upstream cost whenever that cost exists.
  if p_upstream_credits is not null then
    return public.quote_retail_credits_from_upstream_points(p_upstream_credits);
  end if;
  return greatest(0, coalesce(p_standard_credits, 0));
end;
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
  upstream_points_per_second numeric;
begin
  if normalized_provider = 'video-2' then
    normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
      else greatest(4, least(15, coalesce(p_duration, 6))) end;
    upstream_points_per_second := case normalized_resolution
      when '480P' then 8.268929
      when '720P' then 17.7828
      when '720P-SR' then 14.88408
      when '1080P' then 40.0113
      when '1080P-SR' then 32.00904
      when '1440P-SR' then 56.90496
      when '4K' then 91.225764
      else null
    end;
  elsif normalized_provider = 'video-3' then
    normalized_duration := case when coalesce(p_duration, 6) = -1 then 30
      else greatest(4, least(30, coalesce(p_duration, 6))) end;
    upstream_points_per_second := case normalized_resolution
      when '480P' then 10.269725
      when '720P' then 22.085603
      when '720P-SR' then 16.123462
      when '720P-ESR' then 18.485498
      when '1080P' then 43.469408
      when '1080P-SR' then 29.815561
      when '1080P-ESR' then 33.128398
      when '1080P-ESR & 60FPS' then 36.441248
      when '1440P-SR' then 51.454793
      when '1440P-ESR' then 55.876573
      -- $23.11727243 / 10 seconds x CNY 7.3/USD x 10 points/CNY.
      when '4K-ESR' then 168.756088739
      else null
    end;
  elsif normalized_provider = 'video-4' then
    normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
      else greatest(4, least(15, coalesce(p_duration, 6))) end;
    upstream_points_per_second := case normalized_resolution
      when '480P' then 6.16465728
      when '720P' then 12.32931456
      else null
    end;
  else
    return null;
  end if;

  if upstream_points_per_second is null then return null; end if;
  return public.quote_retail_credits_from_upstream_points(
    upstream_points_per_second * normalized_duration
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
  upstream_points numeric;
  rate_per_second numeric;
  quoted_credits integer;
begin
  if normalized_kind = 'image' and normalized_provider in (
    'image-6', 'atlas-image-gpt2', 'atlas-image-gpt2-edit'
  ) then
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

    if normalized_provider = 'atlas-image-gpt2-edit' then
      upstream_points := case normalized_quality
        when 'low' then case normalized_image_resolution when '1k' then 2 else 3 end
        when 'medium' then case normalized_image_resolution when '1k' then 6 when '2k' then 10 else 9 end
        when 'high' then case normalized_image_resolution when '1k' then 17 when '2k' then 33 else 31 end
        else case normalized_image_resolution when '1k' then 6 when '2k' then 10 else 9 end
      end;
    else
      upstream_points := case normalized_quality
        when 'low' then case normalized_image_resolution when '1k' then 1 else 2 end
        when 'medium' then case normalized_image_resolution when '1k' then 5 when '2k' then 9 else 8 end
        when 'high' then case normalized_image_resolution when '1k' then 16 when '2k' then 32 else 30 end
        else case normalized_image_resolution when '1k' then 5 when '2k' then 9 else 8 end
      end;
    end if;
    quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  elsif normalized_kind = 'video' and normalized_provider in (
    'video-2', 'video-3',
    'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
  ) then
    if normalized_provider in ('video-2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref') then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then 8.268929 when '720P' then 17.7828
        when '720P-SR' then 14.88408 when '1080P' then 40.0113
        when '1080P-SR' then 32.00904 when '1440P-SR' then 56.90496
        when '4K' then 91.225764 else null end;
    else
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 30
        else greatest(4, least(30, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then 10.269725 when '720P' then 22.085603
        when '720P-SR' then 16.123462 when '720P-ESR' then 18.485498
        when '1080P' then 43.469408 when '1080P-SR' then 29.815561
        when '1080P-ESR' then 33.128398 when '1080P-ESR & 60FPS' then 36.441248
        when '1440P-SR' then 51.454793 when '1440P-ESR' then 55.876573
        when '4K-ESR' then 168.756088739 else null end;
    end if;
    if rate_per_second is null then return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed'); end if;
    quoted_credits := public.quote_retail_credits_from_upstream_points(rate_per_second * normalized_duration);
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

create or replace function public.reserve_ai_credits(
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
  if normalized_kind = 'chat' then
    if normalized_provider = '' then normalized_provider := 'chat-1'; end if;
    if normalized_provider !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    quoted_credits := 0;
  elsif normalized_kind = 'image' then
    if normalized_provider = '' then normalized_provider := 'image-1'; end if;
    if normalized_provider = 'image-6' then
      return public.reserve_atlas_catalog_credits(
        p_user_id, normalized_kind, normalized_provider, p_request_id,
        p_resolution, p_duration, p_expected_credits
      );
    end if;
    upstream_points := case normalized_provider
      when 'image-1' then 8 when 'image-2' then 6 when 'image-3' then 3
      when 'image-4' then 2 when 'image-5' then 2 else null end;
    if upstream_points is null then return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed'); end if;
    quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    if normalized_provider = 'video-1' then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '2K' then '2K' else '768P' end;
      upstream_points := (case normalized_resolution when '2K' then 8 else 5 end) * normalized_duration;
      quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
    elsif normalized_provider in ('video-2', 'video-3') then
      return public.reserve_atlas_catalog_credits(
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
      upstream_points := case normalized_resolution when '4k' then 4 else 3 end;
    elsif normalized_provider = 'image-10' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      upstream_points := case normalized_resolution when '4k' then 7 else 4 end;
    elsif normalized_provider = 'image-11' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      upstream_points := case normalized_resolution when '4k' then 4 else 3 end;
    elsif normalized_provider = 'image-12' then
      if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '1k'; end if;
      upstream_points := case normalized_resolution when '2k' then 3 when '4k' then 4 else 2 end;
    elsif normalized_provider in ('image-13', 'image-14') then normalized_resolution := null; upstream_points := 2;
    elsif normalized_provider = 'image-15' then
      if normalized_resolution not in ('1k', '2k') then normalized_resolution := '1k'; end if;
      upstream_points := case normalized_resolution when '2k' then 4 else 3 end;
    elsif normalized_provider = 'image-16' then
      if normalized_resolution not in ('512x512', '1024x1024') then normalized_resolution := '512x512'; end if;
      upstream_points := 2;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  elsif normalized_kind = 'video' then
    if normalized_provider = 'video-4' then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      normalized_resolution := upper(trim(coalesce(p_resolution, '')));
      quoted_credits := public.quote_seedance_retail_credits(
        normalized_provider, normalized_resolution, normalized_duration
      );
      if quoted_credits is null then return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed'); end if;
    elsif normalized_provider in ('video-5', 'video-6', 'video-7', 'video-8', 'video-9') then
      if normalized_provider in ('video-5', 'video-6', 'video-7') then
        normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      else
        normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      end if;
      if normalized_provider = 'video-5' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
        upstream_points := (case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration;
      elsif normalized_provider = 'video-6' then
        normalized_resolution := case upper(trim(coalesce(p_resolution, '')))
          when '480P' then '480P' when '720P' then '720P' else '1080P' end;
        upstream_points := (case normalized_resolution when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration;
      elsif normalized_provider = 'video-7' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
        upstream_points := (case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration;
      elsif normalized_provider = 'video-8' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '1080P' then '1080P' else '720P' end;
        upstream_points := (case normalized_resolution when '1080P' then 1 else 0.5 end) * normalized_duration;
      else
        normalized_resolution := '1080P';
        upstream_points := 2 * normalized_duration;
      end if;
      quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
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

create or replace function public.reserve_nano_banana_credits(
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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  upstream_points numeric;
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-1', 'image-2', 'image-5', 'image-9') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_provider = 'image-1' then
    if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '2k'; end if;
    upstream_points := case normalized_resolution when '4k' then 14 else 8 end;
  elsif normalized_provider = 'image-2' then
    if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '2k'; end if;
    upstream_points := case normalized_resolution when '1k' then 4 when '4k' then 8 else 6 end;
  elsif normalized_provider = 'image-5' then
    normalized_resolution := 'default'; upstream_points := 2;
  else
    normalized_resolution := 'default'; upstream_points := 3;
  end if;
  quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_higgsfield_credits(
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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '720p')));
  upstream_points numeric;
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-7', 'image-8') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_resolution not in ('720p', '1080p') then normalized_resolution := '720p'; end if;
  upstream_points := case normalized_resolution when '1080p' then 4 else 2 end;
  quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_legnext_credits(
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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  upstream_points numeric;
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-17', 'image-18') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_resolution not in ('1k', '2k') then normalized_resolution := '1k'; end if;
  upstream_points := case normalized_resolution when '2k' then 10 else 2 end;
  quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text;
  normalized_duration integer;
  upstream_points numeric;
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'video' then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
  if normalized_provider = 'video-10' then normalized_resolution := '720P'; upstream_points := 18.4 * normalized_duration;
  elsif normalized_provider = 'video-11' then normalized_resolution := '1080P'; upstream_points := 24.6 * normalized_duration;
  elsif normalized_provider = 'video-12' then normalized_resolution := '720P'; upstream_points := 21.9 * normalized_duration;
  elsif normalized_provider = 'video-13' then normalized_resolution := '1080P'; upstream_points := 26.3 * normalized_duration;
  else return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'video', normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_supported;
alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_cost_mode_check;
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_supported check (provider_id in (
    'background-remove', 'seededit-v3', 'clipdrop-uncrop', 'kling-image-expand',
    'cleanup', 'clipdrop-upscale', 'generative-upscale',
    'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase',
    'hunyuan3d', 'hyper3d', 'tripo3d', 'topaz-video-upscale',
    'topaz-image-sharpen', 'topaz-image-sharpen-gen',
    'topaz-image-enhance', 'topaz-image-enhance-gen', 'topaz-image-denoise',
    'topaz-image-restore', 'topaz-image-lighting'
  ));
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_cost_mode_check check (
    (provider_id like 'topaz-%' and provider_cost is not null)
    or (provider_id in ('hunyuan3d', 'hyper3d', 'tripo3d'))
    or (provider_id not like 'topaz-%'
      and provider_id not in ('hunyuan3d', 'hyper3d', 'tripo3d')
      and provider_cost is null)
  );

create or replace function public.reserve_ai_tool_credits(
  p_user_id uuid, p_request_id uuid, p_provider_id text,
  p_credits integer, p_provider_cost integer,
  p_resolution text default null, p_duration integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := nullif(left(trim(coalesce(p_resolution, '')), 32), '');
  normalized_duration integer := case when p_duration is null then null else greatest(1, least(21600, p_duration)) end;
  usage_kind text;
  expected_credits integer;
  is_three_d boolean;
begin
  is_three_d := normalized_provider in ('hunyuan3d', 'hyper3d', 'tripo3d');
  usage_kind := case
    when normalized_provider = 'topaz-video-upscale' then 'video'
    when is_three_d then '3d'
    when normalized_provider in (
      'background-remove', 'seededit-v3', 'clipdrop-uncrop', 'kling-image-expand',
      'cleanup', 'clipdrop-upscale', 'generative-upscale',
      'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase',
      'topaz-image-sharpen', 'topaz-image-sharpen-gen',
      'topaz-image-enhance', 'topaz-image-enhance-gen', 'topaz-image-denoise',
      'topaz-image-restore', 'topaz-image-lighting'
    ) then 'image' else null end;
  expected_credits := case normalized_provider
    when 'hunyuan3d' then case when p_provider_cost between 0 and 100000
      then ceil(p_provider_cost::numeric * 0.01 * 7.3 * 10 * 1.20)::integer else null end
    when 'hyper3d' then case when p_provider_cost between 0 and 100000
      then ceil(p_provider_cost::numeric * 0.01 * 7.3 * 10 * 1.20)::integer else null end
    when 'tripo3d' then case when p_provider_cost between 0 and 100000
      then ceil(p_provider_cost::numeric * 0.01 * 7.3 * 10 * 1.20)::integer else null end
    else case when usage_kind is not null then 0 else null end end;
  if usage_kind is null or expected_credits is null
     or p_credits is null
     or p_credits < 0 or p_credits > 3000000
     or (is_three_d and p_credits <> expected_credits)
     or (is_three_d and (p_provider_cost is null or p_provider_cost < 0 or p_provider_cost > 100000))
     or (normalized_provider like 'topaz-%' and (p_provider_cost is null or p_provider_cost < 0 or p_provider_cost > 1000000))
     or (not is_three_d and normalized_provider not like 'topaz-%' and p_provider_cost is not null) then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  return public.reserve_priced_ai_tool_credits_internal(
    p_user_id, p_request_id, normalized_provider, p_provider_cost,
    normalized_resolution, normalized_duration, usage_kind, expected_credits
  );
end;
$$;

create or replace function public.reserve_topaz_image_credits(
  p_user_id uuid, p_request_id uuid, p_provider_id text,
  p_credits integer, p_provider_cost integer,
  p_resolution text default null, p_duration integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  expected_credits integer;
begin
  if normalized_provider not in (
    'topaz-image-sharpen', 'topaz-image-sharpen-gen',
    'topaz-image-enhance', 'topaz-image-enhance-gen', 'topaz-image-denoise',
    'topaz-image-restore', 'topaz-image-lighting'
  ) or p_provider_cost is null or p_provider_cost < 0 or p_provider_cost > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  expected_credits := 0;
  if p_credits is null or p_credits < 0 or p_credits > 3000000 then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  return public.reserve_priced_ai_tool_credits_internal(
    p_user_id, p_request_id, normalized_provider, p_provider_cost,
    null, null, 'image', expected_credits
  );
end;
$$;

revoke all on function public.quote_retail_credits_from_upstream_points(numeric)
  from public, anon, authenticated;
revoke all on function public.apply_ai_pricing_tier(uuid, integer, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.quote_seedance_retail_credits(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.quote_seedance_retail_credits(text, text, integer) to service_role;
revoke all on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_nano_banana_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_nano_banana_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_higgsfield_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_higgsfield_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_kling_video_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_kling_video_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer) to service_role;
revoke all on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer) to service_role;

notify pgrst, 'reload schema';
