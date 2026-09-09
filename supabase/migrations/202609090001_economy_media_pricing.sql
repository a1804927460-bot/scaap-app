-- Target 16.9% margin after 8.1% payment fees; retain 10% cost buffer.
-- Verified AI Reiter default Nano Banana channels, 2026-09-09.
-- No existing balances or historical usage records are changed.
-- The desktop and gateway quote from the same raw upstream cost tables.
-- Every paid image and video reservation uses:
--   ceil((upstream cost + operating cost) * 1.10 / 0.75)
-- Existing balances and settled ledger rows are never repriced.

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
as $$ select 0.013 * 10.0 $$;

create or replace function public.quote_video_operating_cost_upstream_points()
returns numeric
language sql
immutable
set search_path = public
as $$ select 0.250 * 10.0 $$;

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
  select public.quote_media_retail_credits_from_cny(
    (case when upper(trim(coalesce(p_resolution, ''))) = '2K' then 0.1825 else 0.1125 end)
      * 7.3 * greatest(0, coalesce(p_output_seconds, 0) + coalesce(p_input_seconds, 0))
    + 0.055 * 7.3 * greatest(0, coalesce(p_input_image_count, 0) - 5)
    + 0.250
  )
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
  if provider_id in ('image-17', 'image-18') then
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


NOTIFY pgrst, 'reload schema';
