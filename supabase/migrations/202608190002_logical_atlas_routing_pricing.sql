-- Keep logical public provider ids on the Atlas pricing path. Atlas is the
-- primary route, while 302 is a transparent fallback behind the same id.
-- The quote is deliberately the higher route cost for each supported tier so
-- an upstream failover cannot undercharge a request.

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
  if normalized_kind = 'image' and normalized_provider in (
    'image-6', 'atlas-image-gpt2', 'atlas-image-gpt2-edit'
  ) then
    normalized_resolution := lower(trim(coalesce(p_resolution, 'auto')));
    if normalized_resolution not in ('low', 'medium', 'high', 'auto') then
      normalized_resolution := 'auto';
    end if;
    quoted_credits := case normalized_provider
      when 'image-6' then case normalized_resolution
        when 'low' then 16
        when 'medium' then 18
        when 'high' then 28
        else 20
      end
      when 'atlas-image-gpt2-edit' then case normalized_resolution
        when 'high' then 20
        else 15
      end
      else case normalized_resolution
        when 'high' then 20
        else 15
      end
    end;
  elsif normalized_kind = 'video' and normalized_provider in (
    'video-2', 'video-3',
    'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
  ) then
    if normalized_provider in ('video-2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref') then
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 15
        else greatest(4, least(15, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then case when normalized_provider = 'video-2' then 6.94801152 else 3.808 end
        when '720P' then case when normalized_provider = 'video-2' then 13.89602304 else 7.616 end
        when '720P-SR' then 8.378
        when '1080P' then 11.424
        when '1080P-SR' then 12.947
        when '1440P-SR' then 15.232
        when '4K' then 19.04
        else null
      end;
    else
      normalized_duration := case when coalesce(p_duration, 6) = -1 then 30
        else greatest(4, least(30, coalesce(p_duration, 6))) end;
      rate_per_second := case normalized_resolution
        when '480P' then case when normalized_provider = 'video-3' then 8.8128 else 4.556 end
        when '720P' then case when normalized_provider = 'video-3' then 17.6256 else 9.112 end
        when '720P-SR' then 10.023
        when '720P-ESR' then 10.023
        when '1080P' then 13.668
        when '1080P-SR' then 15.490
        when '1080P-ESR' then 15.490
        when '1080P-ESR & 60FPS' then 18.228
        when '1440P-SR' then 18.224
        when '1440P-ESR' then 18.224
        when '4K-ESR' then 22.780
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
