create or replace function public.reserve_fal_tool_credits(
  p_user_id uuid, p_request_id uuid, p_provider_id text,
  p_resolution text, p_expected_credits integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare upstream_usd numeric; credits integer;
begin
  if p_resolution is null or (p_provider_id = 'clipdrop-upscale' and p_resolution !~ '^([1-9]|1[0-9]|2[0-4])MP$')
    or (p_provider_id <> 'clipdrop-upscale' and p_resolution not in ('1K', '4K')) then
    return jsonb_build_object('ok', false, 'reason', 'invalid-resolution');
  end if;
  upstream_usd := case p_provider_id
    when 'clipdrop-upscale' then 0.08
    when 'background-remove' then 0.001
    when 'clipdrop-uncrop' then (case when p_resolution = '4K' then 0.30 else 0.15 end) + 0.05
    else null end;
  if upstream_usd is null then return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed'); end if;
  credits := public.quote_media_retail_credits_from_cny(upstream_usd * 7.3 + 0.013);
  return public.reserve_priced_ai_credits_internal(p_user_id, 'image', p_provider_id, p_request_id, p_resolution, null, p_expected_credits, credits);
end;
$$;
revoke all on function public.reserve_fal_tool_credits(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_fal_tool_credits(uuid, uuid, text, text, integer) to service_role;
notify pgrst, 'reload schema';
