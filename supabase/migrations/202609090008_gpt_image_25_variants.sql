-- Align GPT Image 2.5 with AIReiter's live Flare/Sunburst IDs and
-- resolution-only pricing. Existing settled ledger rows remain immutable.
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
  if provider_id in ('image-19','aireiter-image-gpt25-flare','aireiter-image-gpt25-sunburst') then
    image_resolution := case when supplied_resolution in ('1k','2k','4k') then supplied_resolution else '2k' end;
    return case image_resolution when '1k' then 3 when '4k' then 5 else 4 end;
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

insert into public.upstream_cost_rates
  (provider_id, logical_model, variant, resolution, quality, duration_seconds,
   reference_image_count, reference_video_seconds, cost_usd, currency,
   source_url, verified_at, expires_at, enabled)
values
  ('aireiter','gpt-image-2.5','flare','1K','',0,0,0,0.020,'USD','https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '7 days',true),
  ('aireiter','gpt-image-2.5','flare','2K','',0,0,0,0.025,'USD','https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '7 days',true),
  ('aireiter','gpt-image-2.5','flare','4K','',0,0,0,0.035,'USD','https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '7 days',true),
  ('aireiter','gpt-image-2.5','sunburst','1K','',0,0,0,0.020,'USD','https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '7 days',true),
  ('aireiter','gpt-image-2.5','sunburst','2K','',0,0,0,0.025,'USD','https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '7 days',true),
  ('aireiter','gpt-image-2.5','sunburst','4K','',0,0,0,0.035,'USD','https://aireiter.com/image/gpt-image-2-5',now(),now()+interval '7 days',true)
on conflict (provider_id, logical_model, variant, resolution, quality, duration_seconds, reference_image_count, reference_video_seconds)
do update set cost_usd=excluded.cost_usd, currency=excluded.currency,
  source_url=excluded.source_url, verified_at=excluded.verified_at,
  expires_at=excluded.expires_at, enabled=true;

notify pgrst, 'reload schema';
