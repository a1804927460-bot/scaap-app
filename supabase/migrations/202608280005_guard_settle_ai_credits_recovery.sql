-- Keep a reservation held while an accepted media task is still recoverable.
-- This preserves the existing RPC signature and prevents a late failure path
-- from releasing points before the durable image/video job is reconciled.

create or replace function public.settle_ai_credits(
  p_request_id uuid,
  p_status text,
  p_duration_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  normalized_status text := case when p_status = 'succeeded' then 'succeeded' else 'failed' end;
  account_record public.ai_credit_accounts%rowtype;
  usage_record public.ai_usage%rowtype;
  charge integer;
  recovery_pending boolean := false;
begin
  select user_id into target_user_id
  from public.ai_usage
  where request_id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;

  select * into account_record
  from public.ai_credit_accounts
  where user_id = target_user_id
  for update;
  select * into usage_record
  from public.ai_usage
  where request_id = p_request_id
  for update;

  if usage_record.status <> 'reserved' then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already-settled',
      'status', usage_record.status,
      'creditsCharged', usage_record.credits_charged,
      'account', jsonb_build_object(
        'balance', account_record.balance,
        'reserved', account_record.reserved,
        'availableCredits', account_record.balance - account_record.reserved,
        'overseasUnlocked', account_record.overseas_unlocked,
        'membershipTier', account_record.membership_tier
      )
    );
  end if;

  if normalized_status = 'failed' then
    select exists (
      select 1
      from public.ai_image_jobs as image_job
      where image_job.request_id = p_request_id
        and image_job.status in ('starting', 'submitted', 'ready')
        and image_job.deadline_at > now()
    ) or exists (
      select 1
      from public.ai_video_jobs as video_job
      where video_job.request_id = p_request_id
        and video_job.status in ('starting', 'submitted', 'polling', 'ready')
        and video_job.deadline_at > now()
    ) into recovery_pending;

    if recovery_pending then
      return jsonb_build_object(
        'ok', false,
        'reason', 'provider-task-recovery-pending',
        'status', 'reserved',
        'creditsHeld', greatest(0, coalesce(usage_record.credits_reserved, 0))
      );
    end if;
  end if;

  charge := usage_record.credits_reserved;
  if account_record.reserved < charge or account_record.balance < charge then
    return jsonb_build_object('ok', false, 'reason', 'account-inconsistent');
  end if;

  if normalized_status = 'succeeded' then
    update public.ai_credit_accounts
    set balance = balance - charge, reserved = reserved - charge, updated_at = now()
    where user_id = target_user_id returning * into account_record;
    update public.ai_usage
    set status = 'succeeded', credits_charged = charge,
        duration_ms = greatest(0, coalesce(p_duration_ms, 0)), completed_at = now()
    where request_id = p_request_id;
    if charge > 0 then
      insert into public.ai_credit_ledger
        (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
         request_id, reference_id, idempotency_key, metadata)
      values
        (target_user_id, 'charge', -charge, -charge, account_record.balance,
         account_record.reserved, p_request_id, p_request_id::text,
         'settle:' || p_request_id::text, jsonb_build_object('status', 'succeeded'))
      on conflict (user_id, idempotency_key) do nothing;
    end if;
  else
    update public.ai_credit_accounts
    set reserved = reserved - charge, updated_at = now()
    where user_id = target_user_id returning * into account_record;
    update public.ai_usage
    set status = 'failed', credits_charged = 0,
        duration_ms = greatest(0, coalesce(p_duration_ms, 0)), completed_at = now()
    where request_id = p_request_id;
    if charge > 0 then
      insert into public.ai_credit_ledger
        (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
         request_id, reference_id, idempotency_key, metadata)
      values
        (target_user_id, 'release', 0, -charge, account_record.balance,
         account_record.reserved, p_request_id, p_request_id::text,
         'settle:' || p_request_id::text, jsonb_build_object('status', 'failed'))
      on conflict (user_id, idempotency_key) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'settled',
    'status', normalized_status,
    'creditsCharged', case when normalized_status = 'succeeded' then charge else 0 end,
    'creditsReleased', case when normalized_status = 'failed' then charge else 0 end,
    'account', jsonb_build_object(
      'balance', account_record.balance,
      'reserved', account_record.reserved,
      'availableCredits', account_record.balance - account_record.reserved,
      'overseasUnlocked', account_record.overseas_unlocked,
      'membershipTier', account_record.membership_tier
    )
  );
end;
$$;

revoke all on function public.settle_ai_credits(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.settle_ai_credits(uuid, text, integer) to service_role;

notify pgrst, 'reload schema';
