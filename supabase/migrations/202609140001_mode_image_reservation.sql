BEGIN;

-- Additive RPC: older desktops keep the normal-mode contract unchanged.
-- Recompute the mode price inside the database; never trust a client total.
create or replace function public.reserve_ai_mode_media_credits(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text default null, p_duration integer default null,
  p_expected_credits integer default null, p_count integer default 1,
  p_performance_mode text default 'normal'
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  provider text := lower(trim(coalesce(p_provider_id, '')));
  resolution text := lower(trim(coalesce(p_resolution, '')));
  mode text := lower(trim(coalesce(p_performance_mode, 'normal')));
  unit_credits integer;
  image_count integer := greatest(1, least(4, coalesce(p_count, 1)));
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image' or mode not in ('normal', 'performance') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  unit_credits := public.quote_ai_image_unit_credits(provider, resolution);
  if unit_credits is null then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if mode = 'performance' then
    unit_credits := ceil(unit_credits::numeric * 8 / 5)::integer;
  end if;
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', provider, p_request_id, resolution, null,
    p_expected_credits, unit_credits * image_count
  );
end;
$$;
revoke all on function public.reserve_ai_mode_media_credits(uuid,text,text,uuid,text,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.reserve_ai_mode_media_credits(uuid,text,text,uuid,text,integer,integer,integer,text) to service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
