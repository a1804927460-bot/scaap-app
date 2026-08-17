-- Correct Seedance retail pricing: 302 PTC is USD, not app points.
-- The verified 2.5 720P quote is 2.592 PTC for ten seconds. Rates below
-- convert PTC/USD -> CNY -> points and add the CNY 1.4 job profit once.

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
  ptc_per_second numeric;
begin
  if normalized_provider = 'video-2' then
    normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
    if normalized_resolution <> '480P' then normalized_resolution := '720P'; end if;
    ptc_per_second := case normalized_resolution
      when '480P' then 0.1296 * (7.884 / 10)
      else 0.2592 * (7.884 / 10)
    end;
  elsif normalized_provider = 'video-3' then
    normalized_duration := greatest(4, least(30, coalesce(p_duration, 6)));
    if normalized_resolution <> '480P' then normalized_resolution := '720P'; end if;
    ptc_per_second := case normalized_resolution
      when '480P' then 0.1296
      else 0.2592
    end;
  elsif normalized_provider = 'video-4' then
    normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
    if normalized_resolution <> '480P' then normalized_resolution := '720P'; end if;
    ptc_per_second := case normalized_resolution
      when '480P' then 0.1296 * (6.516 / 10)
      else 0.2592 * (6.516 / 10)
    end;
  else
    return null;
  end if;

  return greatest(30, ceil((ptc_per_second * normalized_duration * 6.8 + 1.4) * 10)::integer);
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
      normalized_resolution := lower(trim(coalesce(p_resolution, 'auto')));
      if normalized_resolution not in ('low', 'medium', 'high', 'auto') then normalized_resolution := 'auto'; end if;
      quoted_credits := case normalized_resolution
        when 'low' then 16 when 'medium' then 18 when 'high' then 28 else 20 end;
    else
      quoted_credits := case normalized_provider
        when 'image-1' then 22 when 'image-2' then 20 when 'image-3' then 17
        when 'image-4' then 16 when 'image-5' then 16 else null end;
    end if;
    if quoted_credits is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    if normalized_provider = 'video-1' then
      normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '2K' then '2K' else '768P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '2K' then 8 else 5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider in ('video-2', 'video-3', 'video-4') then
      normalized_duration := case when normalized_provider = 'video-3'
        then greatest(4, least(30, coalesce(p_duration, 6)))
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := public.quote_seedance_retail_credits(
        normalized_provider, normalized_resolution, normalized_duration
      );
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
  quoted_credits integer;
begin
  if normalized_kind = 'image' then
    if normalized_provider = 'image-3' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 18 else 17 end;
    elsif normalized_provider = 'image-10' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 21 else 18 end;
    elsif normalized_provider = 'image-11' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 18 else 17 end;
    elsif normalized_provider = 'image-12' then
      if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '1k'; end if;
      quoted_credits := case normalized_resolution when '2k' then 17 when '4k' then 18 else 16 end;
    elsif normalized_provider = 'image-13' then normalized_resolution := null; quoted_credits := 16;
    elsif normalized_provider = 'image-14' then normalized_resolution := null; quoted_credits := 16;
    elsif normalized_provider = 'image-15' then
      if normalized_resolution not in ('1k', '2k') then normalized_resolution := '1k'; end if;
      quoted_credits := case normalized_resolution when '2k' then 18 else 17 end;
    elsif normalized_provider = 'image-16' then
      if normalized_resolution not in ('512x512', '1024x1024') then normalized_resolution := '512x512'; end if;
      quoted_credits := 16;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = 'video-4' then
      normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := public.quote_seedance_retail_credits(
        normalized_provider, normalized_resolution, normalized_duration
      );
    elsif normalized_provider = 'video-5' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-6' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case upper(trim(coalesce(p_resolution, '')))
        when '480P' then '480P' when '720P' then '720P' else '1080P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-7' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-8' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '1080P' then '1080P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '1080P' then 1 else 0.5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-9' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := '1080P';
      quoted_credits := greatest(30, ceil(2 * normalized_duration + 14)::integer);
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

revoke all on function public.quote_seedance_retail_credits(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.quote_seedance_retail_credits(text, text, integer)
  to service_role;

notify pgrst, 'reload schema';
