-- Refund historical video jobs that are provably failed after an older client
-- charged them. A request is eligible only when the provider job is failed
-- while its usage row still says succeeded and has a positive debit.
-- The request idempotency key makes the repair safe to run more than once.

create or replace function public.refund_failed_ai_video_delivery(
  p_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_video_jobs%rowtype;
  usage_record public.ai_usage%rowtype;
  account_record public.ai_credit_accounts%rowtype;
  refund_credits integer;
  refund_key text := 'refund:failed-video-delivery:' || p_request_id::text;
begin
  if p_user_id is null or p_request_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid-request');
  end if;

  if exists (
    select 1 from public.ai_credit_ledger
    where user_id = p_user_id and idempotency_key = refund_key
  ) then
    return jsonb_build_object('ok', true, 'reason', 'already-refunded', 'creditsRefunded', 0);
  end if;

  select * into usage_record
  from public.ai_usage
  where user_id = p_user_id and request_id = p_request_id
  for update;
  select * into job
  from public.ai_video_jobs
  where user_id = p_user_id and request_id = p_request_id
  for update;

  if not found
     or usage_record.request_id is null
     or job.request_id is null
     or lower(coalesce(job.status, '')) <> 'failed'
     or lower(coalesce(usage_record.status, '')) <> 'succeeded'
     or coalesce(usage_record.credits_charged, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'not-eligible', 'creditsRefunded', 0);
  end if;

  refund_credits := greatest(0, usage_record.credits_charged);
  select * into account_record
  from public.ai_credit_accounts
  where user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account-not-found', 'creditsRefunded', 0);
  end if;

  update public.ai_credit_accounts
  set balance = balance + refund_credits, updated_at = now()
  where user_id = p_user_id
  returning * into account_record;

  update public.ai_usage
  set status = 'failed', credits_charged = 0, completed_at = coalesce(completed_at, now())
  where user_id = p_user_id and request_id = p_request_id;

  update public.ai_video_jobs
  set credits_charged = 0, updated_at = now()
  where user_id = p_user_id and request_id = p_request_id;

  insert into public.ai_credit_ledger (
    user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
    request_id, reference_id, idempotency_key, metadata
  ) values (
    p_user_id, 'adjustment', refund_credits, 0, account_record.balance,
    account_record.reserved, p_request_id, p_request_id::text, refund_key,
    jsonb_build_object(
      'reason', 'historical-failed-video-delivery',
      'sourceStatus', 'failed-job-with-succeeded-usage'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reason', 'refunded',
    'status', 'failed',
    'creditsRefunded', refund_credits,
    'account', jsonb_build_object(
      'balance', account_record.balance,
      'reserved', account_record.reserved,
      'availableCredits', account_record.balance - account_record.reserved
    )
  );
end;
$$;

revoke all on function public.refund_failed_ai_video_delivery(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_failed_ai_video_delivery(uuid, uuid)
  to service_role;

-- Repair every unambiguous historical case once. The RPC remains available
-- for a later targeted repair and is idempotent by request id.
do $$
declare
  candidate record;
begin
  for candidate in
    select job.user_id, job.request_id
    from public.ai_video_jobs job
    join public.ai_usage usage_row on usage_row.user_id = job.user_id
      and usage_row.request_id = job.request_id
    where lower(coalesce(job.status, '')) = 'failed'
      and lower(coalesce(usage_row.status, '')) = 'succeeded'
      and coalesce(usage_row.credits_charged, 0) > 0
  loop
    perform public.refund_failed_ai_video_delivery(candidate.user_id, candidate.request_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
