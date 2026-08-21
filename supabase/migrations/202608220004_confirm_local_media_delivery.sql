-- New desktop builds reserve paid image/video usage first and settle only after
-- the generated file has been durably written into the local canvas archive.
-- Older clients keep their existing immediate-settlement path in the gateway.

create or replace function public.confirm_ai_media_delivery(
  p_user_id uuid,
  p_request_id uuid,
  p_delivered boolean,
  p_duration_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_record public.ai_usage%rowtype;
  expected_status text := case when p_delivered is true then 'succeeded' else 'failed' end;
  settlement jsonb;
begin
  select * into usage_record
  from public.ai_usage
  where request_id = p_request_id
    and user_id = p_user_id
    and kind in ('image', 'video', '3d')
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  if usage_record.status <> 'reserved' then
    if usage_record.status = expected_status then
      return jsonb_build_object(
        'ok', true,
        'reason', 'already-confirmed',
        'status', usage_record.status,
        'creditsEstimated', usage_record.credits_reserved,
        'creditsCharged', usage_record.credits_charged
      );
    end if;
    return jsonb_build_object(
      'ok', false,
      'reason', 'delivery-status-conflict',
      'status', usage_record.status
    );
  end if;

  settlement := public.settle_ai_credits(
    p_request_id,
    expected_status,
    greatest(0, coalesce(p_duration_ms, 0))
  );
  if coalesce((settlement->>'ok')::boolean, false) is not true
     or coalesce(settlement->>'status', '') <> expected_status then
    return jsonb_build_object('ok', false, 'reason', 'credit-settlement-failed');
  end if;

  return settlement || jsonb_build_object(
    'reason', case when p_delivered is true then 'delivery-confirmed' else 'delivery-released' end,
    'creditsEstimated', usage_record.credits_reserved
  );
end;
$$;

revoke all on function public.confirm_ai_media_delivery(uuid, uuid, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.confirm_ai_media_delivery(uuid, uuid, boolean, integer)
  to service_role;

notify pgrst, 'reload schema';
