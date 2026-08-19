-- AtlasCloud catalog pricing. 302/Atlas prices are kept in USD upstream
-- metadata and converted to app points in the gateway (10 points/CNY).
-- This function repeats the same quote server-side so a stale client cannot
-- under-reserve credits during a rolling deployment.

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
  rate_per_second numeric;
  quoted_credits integer;
begin
  if normalized_kind = 'image'
     and normalized_provider in ('atlas-image-gpt2', 'atlas-image-gpt2-edit') then
    -- For GPT Image 2 the gateway passes the quality in p_resolution.
    normalized_resolution := lower(trim(coalesce(p_resolution, 'auto')));
    if normalized_resolution not in ('low', 'medium', 'high', 'auto') then
      normalized_resolution := 'auto';
    end if;
    quoted_credits := case normalized_resolution
      when 'high' then 20
      else 15
    end;
  elsif normalized_kind = 'video'
        and normalized_provider in (
          'atlas-video-seedance20-i2v',
          'atlas-video-seedance20-ref',
          'atlas-video-seedance25-i2v',
          'atlas-video-seedance25-ref'
        ) then
    -- duration=-1 means upstream-selected duration. Reserve the model's
    -- documented maximum because the final length is unknown at submission.
    if normalized_provider like '%seedance20%' then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then 3.808
        when '720P-SR' then 8.378
        when '1080P' then 11.424
        when '1080P-SR' then 12.947
        when '1440P-SR' then 15.232
        when '4K' then 19.04
        else 7.616
      end;
    else
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 30
        else greatest(4, least(30, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then 4.556
        when '720P-SR' then 10.023
        when '720P-ESR' then 10.023
        when '1080P' then 13.668
        when '1080P-SR' then 15.490
        when '1080P-ESR' then 15.490
        when '1080P-ESR & 60FPS' then 18.228
        when '1440P-SR' then 18.224
        when '1440P-ESR' then 18.224
        when '4K-ESR' then 22.780
        else 9.112
      end;
    end if;
    quoted_credits := greatest(30, ceil(rate_per_second * normalized_duration + 14)::integer);
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id,
    normalized_kind,
    normalized_provider,
    p_request_id,
    normalized_resolution,
    case when normalized_kind = 'video' then normalized_duration else null end,
    p_expected_credits,
    quoted_credits
  );
end;
$$;

revoke all on function public.reserve_atlas_catalog_credits(
  uuid, text, text, uuid, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_atlas_catalog_credits(
  uuid, text, text, uuid, text, integer, integer
) to service_role;

notify pgrst, 'reload schema';
