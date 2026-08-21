-- Calibrate image pricing from observed provider costs.
--
-- The retail formula remains: upstream CNY cost x 1.10 safety buffer x 1.30
-- margin x 10 points/CNY, rounded upward. USD/PTC observations are converted
-- to CNY at the protected 7.3 CNY/USD rate before that formula is applied.

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
    -- Observed GPT Image 2 spend is about USD 0.12 per completed image.
    quoted_credits := public.quote_retail_credits_from_upstream_points(0.12 * 7.3 * 10);
  elsif normalized_kind = 'video'
        and normalized_provider in (
          'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
          'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
        ) then
    if normalized_provider like '%seedance20%' then
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
        else 22.085603 end;
    end if;
    quoted_credits := public.quote_retail_credits_from_upstream_points(
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
      -- Chaser Pro observed spend: about CNY 0.28 at 2K and CNY 0.50 at 4K.
      upstream_points := case normalized_resolution when '4k' then 0.50 * 10 else 0.28 * 10 end;
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
      quoted_credits := public.quote_seedance_retail_credits(normalized_provider, normalized_resolution, normalized_duration);
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
        normalized_resolution := case upper(trim(coalesce(p_resolution, ''))) when '480P' then '480P' when '720P' then '720P' else '1080P' end;
        upstream_points := (case normalized_resolution when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration;
      elsif normalized_provider = 'video-7' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
        upstream_points := (case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration;
      elsif normalized_provider = 'video-8' then
        normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '1080P' then '1080P' else '720P' end;
        upstream_points := (case normalized_resolution when '1080P' then 1 else 0.5 end) * normalized_duration;
      else
        normalized_resolution := '1080P'; upstream_points := 2 * normalized_duration;
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
    -- Nano Banana Pro observed USD/PTC tiers converted at CNY 7.3/USD.
    upstream_points := case normalized_resolution
      when '1k' then 0.14 * 7.3 * 10
      when '4k' then 0.48 * 7.3 * 10
      else 0.24 * 7.3 * 10
    end;
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

notify pgrst, 'reload schema';
