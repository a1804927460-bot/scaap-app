-- Model access is open to every signed-in account. Redemption codes continue
-- to add credits, but the legacy account unlock flag no longer gates AI.

create or replace function public.reserve_ai_credits(
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
  quoted_credits integer;
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
  stale_record record;
begin
  if normalized_kind = 'chat' then
    if normalized_provider = '' then normalized_provider := 'chat-1'; end if;
    if normalized_provider !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    quoted_credits := 0;
  elsif normalized_kind = 'image' then
    if normalized_provider = '' then normalized_provider := 'image-1'; end if;
    quoted_credits := case normalized_provider
      when 'image-1' then 16
      when 'image-2' then 7
      when 'image-3' then 5
      when 'image-4' then 4
      when 'image-5' then 8
      else null
    end;
    if quoted_credits is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    if normalized_provider <> 'video-1' then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    normalized_resolution := case when upper(trim(coalesce(p_resolution, '768P'))) = '2K' then '2K' else '768P' end;
    normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
    quoted_credits := (case normalized_resolution when '2K' then 16 else 10 end) * normalized_duration;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  if p_expected_credits is not null and p_expected_credits <> quoted_credits then
    return jsonb_build_object('ok', false, 'reason', 'pricing-mismatch', 'credits', quoted_credits);
  end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;

  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id;
  if quota_record.suspended then
    return jsonb_build_object('ok', false, 'reason', 'account-suspended');
  end if;

  -- Release stale reservations left by a gateway restart before checking the
  -- currently available balance.
  for stale_record in
    select request_id, credits_reserved
    from public.ai_usage
    where user_id = p_user_id and status = 'reserved'
      and credits_reserved > 0 and created_at < now() - interval '30 minutes'
    order by created_at
    for update
  loop
    update public.ai_credit_accounts
    set reserved = greatest(0, reserved - stale_record.credits_reserved), updated_at = now()
    where user_id = p_user_id returning * into account_record;
    update public.ai_usage
    set status = 'failed', completed_at = now(), duration_ms = null
    where request_id = stale_record.request_id;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'expire', 0, -stale_record.credits_reserved, account_record.balance,
       account_record.reserved, stale_record.request_id, stale_record.request_id::text,
       'expire:' || stale_record.request_id::text, '{}'::jsonb)
    on conflict (user_id, idempotency_key) do nothing;
  end loop;

  select * into usage_record from public.ai_usage where request_id = p_request_id for update;
  if found then
    if usage_record.user_id <> p_user_id
       or usage_record.kind <> normalized_kind
       or coalesce(usage_record.provider_id, '') <> normalized_provider
       or usage_record.credits_reserved <> quoted_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    if usage_record.status in ('reserved', 'succeeded') then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict', 'credits', quoted_credits,
        'balance', account_record.balance, 'reserved', account_record.reserved,
        'availableCredits', account_record.balance - account_record.reserved);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
  end if;

  if account_record.balance - account_record.reserved < quoted_credits then
    return jsonb_build_object('ok', false, 'reason', 'insufficient-credits', 'credits', quoted_credits,
      'availableCredits', account_record.balance - account_record.reserved);
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, normalized_kind, normalized_provider,
     normalized_resolution, normalized_duration, quoted_credits);

  if quoted_credits > 0 then
    update public.ai_credit_accounts
    set reserved = reserved + quoted_credits, updated_at = now()
    where user_id = p_user_id returning * into account_record;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'reserve', 0, quoted_credits, account_record.balance, account_record.reserved,
       p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
       jsonb_build_object('kind', normalized_kind, 'providerId', normalized_provider,
                          'resolution', normalized_resolution, 'duration', normalized_duration));
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'reserved',
    'credits', quoted_credits,
    'balance', account_record.balance,
    'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved
  );
end;
$$;

revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
