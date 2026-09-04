-- Include per-operation infrastructure costs in authoritative media pricing.
-- Migration maintenance is amortized; it is never charged as a one-off fee.
-- Image allocation: CNY 0.013/output. Video allocation: CNY 0.250/task.

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
    ceil((case when upper(trim(coalesce(p_resolution, ''))) = '2K'
      then 0.1825 else 0.1125 end) * 7.3 * (1000.0 / 70.0) * 1.10 / 0.80)
      * greatest(0, coalesce(p_output_seconds, 0) + coalesce(p_input_seconds, 0))
    + ceil(0.055 * 7.3 * (1000.0 / 70.0) * 1.10 / 0.80)
      * greatest(0, coalesce(p_input_image_count, 0) - 5)
    + ceil(public.quote_video_operating_cost_upstream_points() * 1.10 / 0.80)
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
  upstream_points numeric;
begin
  if provider_id in ('image-6', 'atlas-image-gpt2', 'atlas-image-gpt2-edit') then
    quality := split_part(supplied_resolution || ':1k', ':', 1);
    image_resolution := split_part(supplied_resolution || ':1k', ':', 2);
    if quality not in ('low', 'medium', 'high', 'auto') then quality := 'auto'; end if;
    if image_resolution not in ('1k', '2k', '4k') then image_resolution := '1k'; end if;
    upstream_points := case
      when provider_id = 'atlas-image-gpt2' then case quality
        when 'low' then case image_resolution when '1k' then 1 else 2 end
        when 'high' then case image_resolution when '1k' then 16 else 32 end
        else case image_resolution when '1k' then 5 else 9 end
      end
      else case quality
        when 'low' then case image_resolution when '1k' then 2 else 3 end
        when 'high' then case image_resolution when '1k' then 17 else 33 end
        else case image_resolution when '1k' then 6 else 10 end
      end
    end;
    return public.quote_retail_credits_from_upstream_points(
      upstream_points + public.quote_image_operating_cost_upstream_points());
  end if;
  if provider_id = 'image-3' then
    return case when supplied_resolution = '4k' then 8 else 5 end;
  end if;
  upstream_points := case provider_id
    when 'image-1' then case supplied_resolution
      when '1k' then 0.14 * 7.3 * (1000.0 / 70.0)
      when '4k' then 0.48 * 7.3 * (1000.0 / 70.0)
      else 0.24 * 7.3 * (1000.0 / 70.0) end
    when 'image-2' then case supplied_resolution
      when '1k' then 0.048 * 7.3 * (1000.0 / 70.0)
      when '4k' then 0.108 * 7.3 * (1000.0 / 70.0)
      else 0.072 * 7.3 * (1000.0 / 70.0) end
    when 'image-4' then 2 when 'image-5' then 2
    when 'image-7' then case when supplied_resolution = '1080p' then 4 else 2 end
    when 'image-8' then case when supplied_resolution = '1080p' then 4 else 2 end
    when 'image-9' then 3
    when 'image-10' then case when supplied_resolution = '4k' then 7 else 4 end
    when 'image-11' then case when supplied_resolution = '4k' then 4 else 3 end
    when 'image-12' then case supplied_resolution when '2k' then 3 when '4k' then 4 else 2 end
    when 'image-13' then 2 when 'image-14' then 2
    when 'image-15' then case when supplied_resolution = '2k' then 4 else 3 end
    when 'image-16' then 2
    when 'image-17' then case when supplied_resolution = '2k' then 0.32 * 7.3 * (1000.0 / 70.0) else 0.08 * 7.3 * (1000.0 / 70.0) end
    when 'image-18' then case when supplied_resolution = '2k' then 0.32 * 7.3 * (1000.0 / 70.0) else 0.08 * 7.3 * (1000.0 / 70.0) end
    else null
  end;
  if upstream_points is null then return null; end if;
  return public.quote_retail_credits_from_upstream_points(
    upstream_points + public.quote_image_operating_cost_upstream_points());
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
  rate_per_second numeric;
  minimum_upstream_points numeric := 0;
  reference_images integer := greatest(0, coalesce(p_reference_image_count, 0));
begin
  if provider_id = 'video-1' then
    duration := case when coalesce(p_duration, 6) = -1 then 15 else greatest(4, least(15, coalesce(p_duration, 6))) end;
    return public.quote_minimax_h3_video_retail_credits(
      case when resolution = '2K' then '2K' else '768P' end, duration,
      case when coalesce(p_has_reference_video, false) then 15 else 0 end, reference_images);
  end if;
  if provider_id in ('video-2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref') then
    duration := case when coalesce(p_duration, 6) = -1 then 15 else greatest(4, least(15, coalesce(p_duration, 6))) end;
    rate_per_second := case resolution
      when '480P' then 8.268929 when '720P-SR' then 14.88408 when '1080P' then 40.0113
      when '1080P-SR' then 32.00904 when '1440P-SR' then 56.90496 when '4K' then 91.225764
      else 17.7828 end;
  elsif provider_id in ('video-3', 'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref') then
    duration := case when coalesce(p_duration, 6) = -1 then 30 else greatest(4, least(30, coalesce(p_duration, 6))) end;
    rate_per_second := case resolution
      when '480P' then 10.269725 when '720P-SR' then 16.123462 when '720P-ESR' then 18.485498
      when '1080P' then 43.469408 when '1080P-SR' then 29.815561 when '1080P-ESR' then 33.128398
      when '1080P-ESR & 60FPS' then 36.441248 when '1440P-SR' then 51.454793
      when '1440P-ESR' then 55.876573 when '4K-ESR' then 168.756088739 else 22.1160654 end;
    if resolution = '4K-ESR' then minimum_upstream_points := 1687.56088739; end if;
  elsif provider_id = 'video-4' then
    duration := case when coalesce(p_duration, 6) = -1 then 15 else greatest(4, least(15, coalesce(p_duration, 6))) end;
    rate_per_second := case resolution when '480P' then 6.16465728 when '720P' then 12.32931456 else null end;
  elsif provider_id = 'video-5' then duration := greatest(2, least(12, coalesce(p_duration, 6))); rate_per_second := case when resolution = '480P' then 2 else 3 end;
  elsif provider_id = 'video-6' then duration := greatest(2, least(12, coalesce(p_duration, 6))); rate_per_second := case resolution when '480P' then 2 when '720P' then 3 else 4 end;
  elsif provider_id = 'video-7' then duration := greatest(2, least(12, coalesce(p_duration, 6))); rate_per_second := case when resolution = '480P' then 1.5 else 2.5 end;
  elsif provider_id = 'video-8' then duration := greatest(5, least(10, coalesce(p_duration, 6))); rate_per_second := case when resolution = '1080P' then 1 else 0.5 end;
  elsif provider_id = 'video-9' then duration := greatest(5, least(10, coalesce(p_duration, 6))); rate_per_second := 2;
  elsif provider_id = 'video-10' then duration := greatest(3, least(15, coalesce(p_duration, 5))); rate_per_second := 18.4;
  elsif provider_id = 'video-11' then duration := greatest(3, least(15, coalesce(p_duration, 5))); rate_per_second := 24.6;
  elsif provider_id = 'video-12' then duration := greatest(3, least(15, coalesce(p_duration, 5))); rate_per_second := 21.9;
  elsif provider_id = 'video-13' then duration := greatest(3, least(15, coalesce(p_duration, 5))); rate_per_second := 26.3;
  else return null;
  end if;
  if rate_per_second is null then return null; end if;
  return public.quote_video_retail_credits_from_upstream_points(
    greatest(rate_per_second * duration, minimum_upstream_points)
      + public.quote_video_operating_cost_upstream_points());
end;
$$;

revoke all on function public.quote_image_operating_cost_upstream_points() from public, anon, authenticated;
revoke all on function public.quote_video_operating_cost_upstream_points() from public, anon, authenticated;
grant execute on function public.quote_image_operating_cost_upstream_points() to service_role;
grant execute on function public.quote_video_operating_cost_upstream_points() to service_role;
notify pgrst, 'reload schema';
