-- Kling V3/O3 video reservations.
-- Rates are the documented USD/PTC per-second maxima converted at 7.3 CNY/USD
-- and rounded upward in the application. The fixed CNY 1.4 retail margin is
-- applied by this function through the shared pricing-tier helper.

alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_resolution_check;
alter table public.ai_video_jobs
  add constraint ai_video_jobs_resolution_check
  check (resolution in ('480P', '720P', '768P', '1080P', '2K'));

create or replace function public.reserve_kling_video_credits(
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
  upstream_credits numeric;
  quoted_credits integer;
begin
  if normalized_kind <> 'video' then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  if normalized_provider = 'video-10' then
    normalized_resolution := '720P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 18.4 * normalized_duration;
  elsif normalized_provider = 'video-11' then
    normalized_resolution := '1080P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 24.6 * normalized_duration;
  elsif normalized_provider = 'video-12' then
    normalized_resolution := '720P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 21.9 * normalized_duration;
  elsif normalized_provider = 'video-13' then
    normalized_resolution := '1080P';
    normalized_duration := greatest(3, least(15, coalesce(p_duration, 5)));
    upstream_credits := 26.3 * normalized_duration;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  quoted_credits := ceil(upstream_credits + 14)::integer;
  quoted_credits := public.apply_ai_pricing_tier(
    p_user_id, quoted_credits, upstream_credits
  );
  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

revoke all on function public.reserve_kling_video_credits(
  uuid, text, text, uuid, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_kling_video_credits(
  uuid, text, text, uuid, text, integer, integer
) to service_role;
