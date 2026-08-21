-- Approved retail pricing for the public image models and MiniMax H3.
-- All values below are final app points. They must not be multiplied by an
-- FX, safety, or margin factor again. One CNY remains equal to ten app points.

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
    quoted_credits := case normalized_image_resolution
      when '4k' then 40
      else 20
    end;
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
        else 22.1160654 end;
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
    quoted_credits := case normalized_resolution when '4k' then 40 else 20 end;
  elsif normalized_provider = 'image-2' then
    if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '2k'; end if;
    upstream_points := case normalized_resolution when '1k' then 4 when '4k' then 8 else 6 end;
    quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  elsif normalized_provider = 'image-5' then
    normalized_resolution := 'default';
    quoted_credits := public.quote_retail_credits_from_upstream_points(2);
  else
    normalized_resolution := 'default';
    quoted_credits := public.quote_retail_credits_from_upstream_points(3);
  end if;

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
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-17', 'image-18') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_resolution not in ('1k', '2k') then normalized_resolution := '1k'; end if;
  quoted_credits := case normalized_resolution when '2k' then 40 else 12 end;
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
  );
end;
$$;

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
begin
  output_credits := (
    case normalized_resolution when '2K' then 20 else 15 end
  ) * normalized_duration;

  -- The expected quote may be higher because the gateway also reserves input
  -- video seconds and additional reference images. Never accept a quote below
  -- the output-only floor.
  if p_expected_credits is null or p_expected_credits < output_credits then
    return jsonb_build_object(
      'ok', false,
      'reason', 'pricing-mismatch',
      'credits', output_credits
    );
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'video', 'video-1', p_request_id,
    normalized_resolution, normalized_duration,
    p_expected_credits, p_expected_credits
  );
end;
$$;

-- Keep the generic compatibility RPC aligned with the dedicated public-model
-- RPCs. Current gateways use the dedicated routes, while older clients may
-- still reach this function directly.
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
    if normalized_provider in ('image-1', 'image-2', 'image-5', 'image-9') then
      return public.reserve_nano_banana_credits(
        p_user_id, normalized_kind, normalized_provider, p_request_id,
        p_resolution, p_duration, p_expected_credits
      );
    elsif normalized_provider = 'image-6' then
      return public.reserve_atlas_catalog_credits(
        p_user_id, normalized_kind, normalized_provider, p_request_id,
        p_resolution, p_duration, p_expected_credits
      );
    end if;
    upstream_points := case normalized_provider
      when 'image-3' then 2.8 when 'image-4' then 2 else null end;
    if upstream_points is null then return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed'); end if;
    quoted_credits := public.quote_retail_credits_from_upstream_points(upstream_points);
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    if normalized_provider = 'video-1' then
      return public.reserve_minimax_video_credits(
        p_user_id, p_request_id, p_resolution, p_duration, p_expected_credits
      );
    elsif normalized_provider in ('video-2', 'video-3') then
      return public.reserve_atlas_catalog_credits(
        p_user_id, normalized_kind, normalized_provider, p_request_id,
        p_resolution, p_duration, p_expected_credits
      );
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    null, null, p_expected_credits, quoted_credits
  );
end;
$$;

revoke all on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_atlas_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_nano_banana_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_nano_banana_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_minimax_video_credits(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_minimax_video_credits(uuid, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
