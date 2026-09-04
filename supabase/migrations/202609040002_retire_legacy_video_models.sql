-- Retire the old Kling product routes from new reservations. Historical
-- usage rows still use quote_ai_video_retail_credits during settlement and
-- reporting, so their pricing branches remain intentionally intact.

create or replace function public.reserve_ai_video_credits(
  p_user_id uuid,
  p_kind text,
  p_provider_id text,
  p_request_id uuid,
  p_resolution text default null,
  p_duration integer default null,
  p_expected_credits integer default null,
  p_reference_image_count integer default 0,
  p_has_reference_video boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'video'
     or normalized_provider not in ('video-1', 'video-2', 'video-3') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  quoted_credits := public.quote_ai_video_retail_credits(
    normalized_provider, p_resolution, p_duration,
    p_reference_image_count, p_has_reference_video
  );
  if quoted_credits is null then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  -- A higher gateway estimate is conservative input-media protection. Never
  -- lower it during reservation, because a fallback may cost more.
  if p_expected_credits is not null and p_expected_credits > quoted_credits then
    return public.reserve_priced_ai_credits_internal(
      p_user_id, 'video', normalized_provider, p_request_id,
      upper(trim(coalesce(p_resolution, ''))), p_duration,
      p_expected_credits, p_expected_credits
    );
  end if;
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'video', normalized_provider, p_request_id,
    upper(trim(coalesce(p_resolution, ''))), p_duration,
    p_expected_credits, quoted_credits
  );
end;
$$;

revoke all on function public.reserve_ai_video_credits(uuid, text, text, uuid, text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.reserve_ai_video_credits(uuid, text, text, uuid, text, integer, integer, integer, boolean) to service_role;

notify pgrst, 'reload schema';
