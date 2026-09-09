-- Recorded settlements only. Keep fractional Agent credits and pending reservations separate.
begin;
create or replace function public.get_canvas_ai_usage_summary(p_user_id uuid, p_canvas_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if p_user_id is null or trim(coalesce(p_canvas_id,'')) !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'A valid canvas id is required.' using errcode='22023';
  end if;
  select jsonb_build_object('totals',jsonb_build_object(
    'creditsCharged',coalesce(sum(credits_charged),0),
    'estimatedCredits',coalesce(sum(credits_reserved),0),'generations',count(*)),
    'details',coalesce(jsonb_agg(jsonb_build_object(
      'requestId',request_id,'kind',case when provider_id in ('hunyuan3d','hyper3d','tripo3d') then '3d' else kind end,
      'providerId',provider_id,'resolution',resolution,'duration',duration_seconds,
      'creditsCharged',credits_charged,'creditsReserved',credits_reserved,
      'estimatedCredits',credits_reserved,'status',status,'createdAt',created_at
    ) order by created_at desc),'[]'::jsonb)) into result
  from public.ai_usage where user_id=p_user_id and canvas_id=trim(p_canvas_id);
  return result;
end;
$$;
revoke all on function public.get_canvas_ai_usage_summary(uuid,text) from public,anon,authenticated;
grant execute on function public.get_canvas_ai_usage_summary(uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
