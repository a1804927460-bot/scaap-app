-- Server-authoritative Higgsfield retail pricing. This separate RPC keeps the
-- existing production pricing function stable while image-7/image-8 roll out.

create or replace function public.reserve_higgsfield_credits(
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
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '720p')));
  quoted_credits integer;
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-7', 'image-8') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_resolution not in ('720p', '1080p') then normalized_resolution := '720p'; end if;
  quoted_credits := case normalized_resolution when '1080p' then 8 else 4 end;
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

  select * into usage_record from public.ai_usage where request_id = p_request_id for update;
  if found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'request-id-conflict',
      'credits', quoted_credits,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;
  if account_record.balance - account_record.reserved < quoted_credits then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient-credits',
      'credits', quoted_credits,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, 'image', normalized_provider, normalized_resolution, null, quoted_credits);
  update public.ai_credit_accounts
  set reserved = reserved + quoted_credits, updated_at = now()
  where user_id = p_user_id returning * into account_record;
  insert into public.ai_credit_ledger
    (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
     request_id, reference_id, idempotency_key, metadata)
  values
    (p_user_id, 'reserve', 0, quoted_credits, account_record.balance, account_record.reserved,
     p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
     jsonb_build_object('kind', 'image', 'providerId', normalized_provider,
                        'resolution', normalized_resolution));

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

revoke all on function public.reserve_higgsfield_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_higgsfield_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
