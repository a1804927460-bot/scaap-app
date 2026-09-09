-- Verified Legnext 8.2: standard $0.08, native HD $0.12 per task.
-- Apply after 202609090001. Existing reservations and ledger charges stay unchanged.
begin;

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
  upstream_cny numeric;
begin
  -- Active AI Reiter routes. The quality and resolution matrix is taken from
  -- the official GPT Image 2 route; no legacy auto tier is accepted.
  if provider_id = 'image-1' then
    upstream_usd := case supplied_resolution
      when '1k' then 0.05 when '2k' then 0.05 when '4k' then 0.06 else 0.05 end;
    return public.quote_media_retail_credits_from_cny(upstream_usd * 7.3 + 0.013);
  end if;
  if provider_id = 'image-2' then
    upstream_usd := case supplied_resolution
      when '1k' then 0.03 when '2k' then 0.03 when '4k' then 0.035 else 0.03 end;
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

  -- Hidden legacy routes remain reportable, but still receive the same cost
  -- protection and margin instead of their retired fixed prices.
  if provider_id = 'image-18' then
    if supplied_resolution not in ('', '1k', '2k') then return null; end if;
    upstream_cny := case when supplied_resolution = '2k' then 0.12 * 7.3 else 0.08 * 7.3 end;
    return public.quote_media_retail_credits_from_cny(upstream_cny + 0.013);
  end if;
  if provider_id = 'image-17' then
    upstream_cny := case when supplied_resolution = '2k' then 0.32 * 7.3 else 0.08 * 7.3 end;
    return public.quote_media_retail_credits_from_cny(upstream_cny + 0.013);
  end if;
  upstream_cny := case provider_id
    when 'image-3' then case when supplied_resolution = '4k' then 0.50 else 0.28 end
    else null
  end;
  if upstream_cny is not null then
    return public.quote_media_retail_credits_from_cny(upstream_cny + 0.013);
  end if;

  return case provider_id
    when 'image-4' then public.quote_retail_credits_from_upstream_points(2 + 0.013 * 10.0)
    when 'image-5' then public.quote_retail_credits_from_upstream_points(2 + 0.013 * 10.0)
    when 'image-7' then public.quote_retail_credits_from_upstream_points((case when supplied_resolution = '1080p' then 4 else 2 end) + 0.013 * 10.0)
    when 'image-8' then public.quote_retail_credits_from_upstream_points((case when supplied_resolution = '1080p' then 4 else 2 end) + 0.013 * 10.0)
    when 'image-9' then public.quote_retail_credits_from_upstream_points(3 + 0.013 * 10.0)
    when 'image-10' then public.quote_retail_credits_from_upstream_points((case when supplied_resolution = '4k' then 7 else 4 end) + 0.013 * 10.0)
    when 'image-11' then public.quote_retail_credits_from_upstream_points((case when supplied_resolution = '4k' then 4 else 3 end) + 0.013 * 10.0)
    when 'image-12' then public.quote_retail_credits_from_upstream_points((case supplied_resolution when '2k' then 3 when '4k' then 4 else 2 end) + 0.013 * 10.0)
    when 'image-13' then public.quote_retail_credits_from_upstream_points(2 + 0.013 * 10.0)
    when 'image-14' then public.quote_retail_credits_from_upstream_points(2 + 0.013 * 10.0)
    when 'image-15' then public.quote_retail_credits_from_upstream_points((case when supplied_resolution = '2k' then 4 else 3 end) + 0.013 * 10.0)
    when 'image-16' then public.quote_retail_credits_from_upstream_points(2 + 0.013 * 10.0)
    else null
  end;
end;
$$;

-- Keep the legacy service-role reservation entry point on the same quote.
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
  normalized_resolution text := lower(trim(coalesce(p_resolution, '1k')));
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-17', 'image-18') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_resolution = '' then normalized_resolution := '1k'; end if;
  quoted_credits := public.quote_ai_image_unit_credits(normalized_provider, normalized_resolution);
  if quoted_credits is null then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
  );
end;
$$;
revoke all on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
commit;
