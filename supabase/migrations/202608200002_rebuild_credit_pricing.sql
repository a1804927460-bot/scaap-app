-- Rebuild the public credit quote from verified provider prices.
-- Retail rule: 10 points = CNY 1, with CNY 1.4 fixed profit per request.
-- USD/PTC costs use a protected settlement rate of USD 1 = CNY 7.3.

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
    rate_per_second := case normalized_resolution
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
      -- 302 quotes 4K-ESR at 22.780 PTC per 10 seconds (2.278 PTC/sec).
      -- Convert USD/PTC to CNY and app points before adding job profit.
      when '4K-ESR' then 166.294
      else null
    end;
  elsif normalized_provider = 'video-4' then
    normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
      else greatest(4, least(15, coalesce(p_duration, 6))) end;
    rate_per_second := case normalized_resolution
      when '480P' then 6.16465728
      when '720P' then 12.32931456
      else null
    end;
  else
    return null;
  end if;

  if rate_per_second is null then return null; end if;
  return greatest(30, ceil(rate_per_second * normalized_duration + 14)::integer);
end;
$$;

create or replace function public.reserve_atlas_catalog_credits(
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
  normalized_resolution text := upper(trim(coalesce(p_resolution, '')));
  normalized_duration integer;
  normalized_quality text;
  normalized_image_resolution text;
  separator_position integer;
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
    if normalized_quality not in ('low', 'medium', 'high', 'auto') then
      normalized_quality := 'auto';
    end if;
    if normalized_image_resolution not in ('1k', '2k', '4k') then
      normalized_image_resolution := '1k';
    end if;
    normalized_resolution := normalized_quality || ':' || normalized_image_resolution;

    if normalized_provider = 'atlas-image-gpt2-edit' then
      quoted_credits := case normalized_quality
        when 'low' then case normalized_image_resolution when '1k' then 16 else 17 end
        when 'medium' then case normalized_image_resolution when '1k' then 20 when '2k' then 24 else 23 end
        when 'high' then case normalized_image_resolution when '1k' then 31 when '2k' then 47 else 45 end
        else case normalized_image_resolution when '1k' then 20 when '2k' then 24 else 23 end
      end;
    else
      quoted_credits := case normalized_quality
        when 'low' then case normalized_image_resolution when '1k' then 15 else 16 end
        when 'medium' then case normalized_image_resolution when '1k' then 19 when '2k' then 23 else 22 end
        when 'high' then case normalized_image_resolution when '1k' then 30 when '2k' then 46 else 44 end
        else case normalized_image_resolution when '1k' then 19 when '2k' then 23 else 22 end
      end;
    end if;
  elsif normalized_kind = 'video' and normalized_provider in (
    'video-2', 'video-3',
    'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
  ) then
    if normalized_provider in ('video-2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref') then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then 8.268929
        when '720P' then 17.7828
        when '720P-SR' then 14.88408
        when '1080P' then 40.0113
        when '1080P-SR' then 32.00904
        when '1440P-SR' then 56.90496
        when '4K' then 91.225764
        else null
      end;
    else
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 30
        else greatest(4, least(30, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
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
        when '4K-ESR' then 166.294
        else null
      end;
    end if;
    if rate_per_second is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    quoted_credits := greatest(30, ceil(rate_per_second * normalized_duration + 14)::integer);
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution,
    case when normalized_kind = 'video' then normalized_duration else null end,
    p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_ai_credits(
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
    quoted_credits := case normalized_provider
      when 'image-1' then 22 when 'image-2' then 20 when 'image-3' then 17
      when 'image-4' then 16 when 'image-5' then 16 else null end;
    if quoted_credits is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    if normalized_provider = 'video-1' then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '2K' then '2K' else '768P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '2K' then 8 else 5 end) * normalized_duration + 14)::integer
      );
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
      if quoted_credits is null then
        return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
      end if;
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
begin
  usage_kind := case
    when normalized_provider = 'topaz-video-upscale' then 'video'
    when normalized_provider in ('hunyuan3d', 'hyper3d', 'tripo3d') then '3d'
    when normalized_provider in (
      'background-remove', 'seededit-v3', 'kling-image-expand', 'cleanup', 'generative-upscale',
      'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase'
    ) then 'image'
    else null
  end;
  expected_credits := case normalized_provider
    when 'background-remove' then 51
    when 'seededit-v3' then 18
    when 'kling-image-expand' then 51
    when 'cleanup' then 51
    when 'generative-upscale' then 73
    when 'qwen-image-edit-plus' then 16
    when 'qwen-image-layered' then 16
    when 'super-upscale-v2' then 16
    when 'erase' then 16
    when 'hunyuan3d' then 22
    when 'hyper3d' then 28
    when 'tripo3d' then 24
    when 'topaz-video-upscale' then
      case when p_provider_cost between 0 and 1000000
        then ceil((p_provider_cost::numeric * 7.3 + 1.4) * 10)::integer else null end
    else null
  end;
  if usage_kind is null or expected_credits is null
     or p_credits is null or p_credits <> expected_credits
     or p_credits < 0 or p_credits > 3000000
     or (normalized_provider = 'topaz-video-upscale' and p_provider_cost is null)
     or (normalized_provider <> 'topaz-video-upscale' and p_provider_cost is not null) then
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
  expected_credits := ceil((p_provider_cost::numeric * 7.3 + 1.4) * 10)::integer;
  if p_credits is null or p_credits <> expected_credits then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  return public.reserve_priced_ai_tool_credits_internal(
    p_user_id, p_request_id, normalized_provider, p_provider_cost,
    null, null, 'image', expected_credits
  );
end;
$$;

revoke all on function public.quote_seedance_retail_credits(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.quote_seedance_retail_credits(text, text, integer)
  to service_role;
revoke all on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;
revoke all on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;

notify pgrst, 'reload schema';
