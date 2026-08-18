-- Server-authoritative retail pricing for the Legnext Midjourney V8 models.
-- Legnext documents standard V8.1/V8.2 generation at 1x and native HD at
-- 1.5x; the app exposes those as 16 and 24 points respectively.

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
  normalized_kind text := lower(trim(coalesce(p_kind, '')));
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  quoted_credits integer;
begin
  if normalized_kind <> 'image'
     or normalized_provider not in ('image-17', 'image-18') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  if normalized_resolution not in ('1k', '2k') then
    normalized_resolution := '1k';
  end if;
  quoted_credits := case normalized_resolution when '2k' then 24 else 16 end;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
  );
end;
$$;

revoke all on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_legnext_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
