-- Align desktop, gateway, and database quotes on one cost unit.
-- The legacy quote helpers accept upstream points at CNY 0.10 per point and
-- convert them to the current CNY 0.07 app-credit denomination exactly once.
-- All paid media and generation tools include a 10% cost buffer and preserve
-- a 20% gross margin. Existing settled ledger rows remain immutable.

create or replace function public.quote_retail_credits_from_upstream_points(
  p_upstream_points numeric
)
returns integer
language sql
immutable
set search_path = public
as $$
  select ceil(
    greatest(0, coalesce(p_upstream_points, 0))
      * (10.0 / 7.0) * 1.10 / 0.80
  )::integer
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
  select (
    ceil((case when upper(trim(coalesce(p_resolution, ''))) = '2K'
      then 0.1825 else 0.1125 end) * 7.3 * (1000.0 / 70.0) * 1.10 / 0.80)
      * greatest(0, coalesce(p_output_seconds, 0) + coalesce(p_input_seconds, 0))
    + ceil(0.055 * 7.3 * (1000.0 / 70.0) * 1.10 / 0.80)
      * greatest(0, coalesce(p_input_image_count, 0) - 5)
    + ceil(public.quote_video_operating_cost_upstream_points()
      * (10.0 / 7.0) * 1.10 / 0.80)
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
      when '1k' then 0.14 * 7.3 * 10.0
      when '4k' then 0.48 * 7.3 * 10.0
      else 0.24 * 7.3 * 10.0 end
    when 'image-2' then case supplied_resolution
      when '1k' then 0.048 * 7.3 * 10.0
      when '4k' then 0.108 * 7.3 * 10.0
      else 0.072 * 7.3 * 10.0 end
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
    when 'image-17' then case when supplied_resolution = '2k' then 0.32 * 7.3 * 10.0 else 0.08 * 7.3 * 10.0 end
    when 'image-18' then case when supplied_resolution = '2k' then 0.32 * 7.3 * 10.0 else 0.08 * 7.3 * 10.0 end
    else null
  end;
  if upstream_points is null then return null; end if;
  return public.quote_retail_credits_from_upstream_points(
    upstream_points + public.quote_image_operating_cost_upstream_points());
end;
$$;

revoke all on function public.quote_retail_credits_from_upstream_points(numeric) from public, anon, authenticated;
revoke all on function public.quote_image_operating_cost_upstream_points() from public, anon, authenticated;
revoke all on function public.quote_video_operating_cost_upstream_points() from public, anon, authenticated;
grant execute on function public.quote_retail_credits_from_upstream_points(numeric) to service_role;
grant execute on function public.quote_image_operating_cost_upstream_points() to service_role;
grant execute on function public.quote_video_operating_cost_upstream_points() to service_role;
notify pgrst, 'reload schema';
