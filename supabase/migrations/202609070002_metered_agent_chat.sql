-- Fractional chat credits share the existing atomic account and ledger.
-- Media prices remain integral; their account arithmetic uses rowtypes.
begin;
drop view public.ai_usage_attribution;
alter table public.ai_credit_accounts
  alter column balance type numeric(18,2), alter column reserved type numeric(18,2);
alter table public.ai_credit_ledger
  alter column balance_delta type numeric(18,2), alter column reserved_delta type numeric(18,2),
  alter column balance_after type numeric(18,2), alter column reserved_after type numeric(18,2);
alter table public.ai_usage
  alter column credits_reserved type numeric(18,2), alter column credits_charged type numeric(18,2);
create view public.ai_usage_attribution as
  select request_id,user_id,requester_email,requester_auth_provider,upstream_user_id,
    kind,provider_id,status,credits_reserved,credits_charged,created_at,completed_at from public.ai_usage;
revoke all on public.ai_usage_attribution from public,anon,authenticated;
grant all on public.ai_usage_attribution to service_role;

-- Preserve deployed recovery guards and function ACLs while removing only
-- the integer coercions that would destroy fractional account history.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.settle_ai_credits(uuid,text,integer)'::regprocedure) into definition;
  if position('charge integer;' in definition) > 0 then
    execute replace(definition, 'charge integer;', 'charge numeric(18,2);');
  elsif position('charge numeric(18,2);' in definition) = 0 then
    raise exception 'Unexpected settlement definition';
  end if;
  select pg_get_functiondef('public.authoritative_ai_usage_summary(uuid,date,date,text,integer)'::regprocedure) into definition;
  definition := replace(definition, 'coalesce(usage_row.credits_charged, 0))::bigint', 'coalesce(usage_row.credits_charged, 0))::numeric');
  definition := replace(definition, 'sum(credits), 0)::bigint', 'sum(credits), 0)::numeric');
  definition := replace(definition, 'sum(filtered.credits), 0)::bigint', 'sum(filtered.credits), 0)::numeric');
  definition := replace(definition, 'sum(credits)::bigint', 'sum(credits)::numeric');
  execute definition;
end;
$$;

create table public.ai_chat_billing (
  request_id uuid primary key references public.ai_usage(request_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  claim_id uuid not null,
  receipt jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ai_chat_billing enable row level security;
revoke all on public.ai_chat_billing from anon, authenticated;
grant all on public.ai_chat_billing to service_role;

create or replace function public.reserve_ai_chat_credits(
  p_user_id uuid, p_request_id uuid, p_fingerprint text, p_claim_id uuid,
  p_budget numeric, p_update boolean default false, p_provider_id text default 'chat-3'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  account_record public.ai_credit_accounts%rowtype;
  usage_record public.ai_usage%rowtype;
  billing_record public.ai_chat_billing%rowtype;
  delta numeric(18,2);
begin
  if p_budget is null or p_budget < 0.01 or p_budget > 10000 or p_budget <> round(p_budget,2)
     or p_fingerprint is null or length(p_fingerprint) <> 64 or p_claim_id is null then
    return jsonb_build_object('ok',false,'reason','invalid-credit-quote');
  end if;
  insert into public.ai_credit_accounts(user_id) values(p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id=p_user_id for update;
  if exists(select 1 from public.ai_quotas where user_id=p_user_id and suspended) then
    return jsonb_build_object('ok',false,'reason','account-suspended');
  end if;
  -- Expired chat holds are safe to release: the HTTP deadline is ten minutes.
  perform public.settle_ai_credits(u.request_id,'failed',0) from public.ai_usage u
    where u.user_id=p_user_id and u.kind='chat' and u.status='reserved'
      and u.created_at < now()-interval '30 minutes';
  select * into account_record from public.ai_credit_accounts where user_id=p_user_id;
  select * into usage_record from public.ai_usage where request_id=p_request_id for update;
  if found then
    select * into billing_record from public.ai_chat_billing where request_id=p_request_id;
    if usage_record.user_id<>p_user_id or usage_record.kind<>'chat' or usage_record.status<>'reserved'
       or billing_record.request_id is null or billing_record.fingerprint<>p_fingerprint
       or billing_record.claim_id<>p_claim_id then
      return jsonb_build_object('ok',false,'reason','request-id-conflict');
    end if;
    delta := greatest(0,p_budget-usage_record.credits_reserved);
  else
    if p_update then return jsonb_build_object('ok',false,'reason','unknown-request'); end if;
    delta := p_budget;
  end if;
  if account_record.balance-account_record.reserved < delta then
    return jsonb_build_object('ok',false,'reason','insufficient-credits','credits',p_budget,
      'availableCredits',account_record.balance-account_record.reserved);
  end if;
  if usage_record.request_id is null then
    insert into public.ai_usage(request_id,user_id,kind,provider_id,credits_reserved)
      values(p_request_id,p_user_id,'chat',p_provider_id,p_budget);
    insert into public.ai_chat_billing(request_id,user_id,fingerprint,claim_id)
      values(p_request_id,p_user_id,p_fingerprint,p_claim_id);
  else
    update public.ai_usage set credits_reserved=credits_reserved+delta where request_id=p_request_id;
  end if;
  if delta>0 then
    update public.ai_credit_accounts set reserved=reserved+delta,updated_at=now()
      where user_id=p_user_id returning * into account_record;
    insert into public.ai_credit_ledger(user_id,event_type,balance_delta,reserved_delta,balance_after,
      reserved_after,request_id,reference_id,idempotency_key,metadata)
      values(p_user_id,'reserve',0,delta,account_record.balance,account_record.reserved,p_request_id,
        p_request_id::text,'chat-reserve:'||p_request_id::text||':'||p_budget::text,'{"kind":"chat"}');
  end if;
  return jsonb_build_object('ok',true,'reason','reserved','credits',p_budget);
end;
$$;

create or replace function public.settle_ai_chat_credits(
  p_user_id uuid,p_request_id uuid,p_receipt jsonb,p_duration_ms integer default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  account_record public.ai_credit_accounts%rowtype;
  usage_record public.ai_usage%rowtype;
  charge numeric(18,2) := 0;
  released numeric(18,2);
  expected numeric;
  input_tokens bigint;
  cached_tokens bigint;
  output_tokens bigint;
  final_status text := case when p_receipt is null then 'failed' else 'succeeded' end;
begin
  select * into account_record from public.ai_credit_accounts where user_id=p_user_id for update;
  select * into usage_record from public.ai_usage where request_id=p_request_id and user_id=p_user_id for update;
  if not found or usage_record.kind<>'chat' or not exists(
    select 1 from public.ai_chat_billing where request_id=p_request_id and user_id=p_user_id
  ) then return jsonb_build_object('ok',false,'reason','unknown-request'); end if;
  if usage_record.status<>'reserved' then
    return jsonb_build_object('ok',usage_record.status=final_status,'reason','already-settled',
      'status',usage_record.status,'creditsCharged',usage_record.credits_charged);
  end if;
  if p_receipt is not null then
    input_tokens := (p_receipt#>>'{usage,inputTokens}')::bigint;
    cached_tokens := coalesce((p_receipt#>>'{usage,cachedInputTokens}')::bigint,0);
    output_tokens := (p_receipt#>>'{usage,outputTokens}')::bigint;
    if input_tokens is null or output_tokens is null or input_tokens<0 or output_tokens<0
       or cached_tokens<0 or cached_tokens>input_tokens or input_tokens+output_tokens=0
       or coalesce((p_receipt#>>'{usage,cacheCreationTokens}')::bigint,0)<>0 then
      return jsonb_build_object('ok',false,'reason','chat-usage-unavailable');
    end if;
    expected := ceil(((input_tokens-cached_tokens)*(p_receipt#>>'{rate,inputCnyPerMillion}')::numeric
      +cached_tokens*(p_receipt#>>'{rate,cachedInputCnyPerMillion}')::numeric
      +output_tokens*(p_receipt#>>'{rate,outputCnyPerMillion}')::numeric)*120/70000)/100;
    charge := (p_receipt->>'credits')::numeric;
    if charge is null or expected is null or charge<>expected or charge<=0 then
      return jsonb_build_object('ok',false,'reason','pricing-mismatch');
    end if;
    -- Never overdraft or silently debit somebody else's concurrent reservation.
    -- If the provider violates its output/input bound, the operator bears excess.
    charge := least(charge,usage_record.credits_reserved);
  end if;
  released := usage_record.credits_reserved-charge;
  update public.ai_credit_accounts set balance=balance-charge,
    reserved=reserved-usage_record.credits_reserved,updated_at=now()
    where user_id=p_user_id returning * into account_record;
  update public.ai_usage set status=final_status,credits_charged=charge,
    duration_ms=greatest(0,p_duration_ms),completed_at=now(),
    provider_id=coalesce(p_receipt->>'providerId',provider_id)
    where request_id=p_request_id;
  update public.ai_chat_billing set receipt=p_receipt,updated_at=now() where request_id=p_request_id;
  insert into public.ai_credit_ledger(user_id,event_type,balance_delta,reserved_delta,balance_after,
    reserved_after,request_id,reference_id,idempotency_key,metadata)
    values(p_user_id,case when charge>0 then 'charge' else 'release' end,-charge,-usage_record.credits_reserved,
      account_record.balance,account_record.reserved,p_request_id,p_request_id::text,
      'chat-settle:'||p_request_id::text,jsonb_build_object('kind','chat','creditsReleased',released));
  return jsonb_build_object('ok',true,'status',final_status,'creditsCharged',charge,'creditsReleased',released,
    'account',jsonb_build_object('balance',account_record.balance,'reserved',account_record.reserved,
      'availableCredits',account_record.balance-account_record.reserved,
      'overseasUnlocked',account_record.overseas_unlocked,'membershipTier',account_record.membership_tier));
end;
$$;
revoke all on function public.reserve_ai_chat_credits(uuid,uuid,text,uuid,numeric,boolean,text) from public,anon,authenticated;
revoke all on function public.settle_ai_chat_credits(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_chat_credits(uuid,uuid,text,uuid,numeric,boolean,text) to service_role;
grant execute on function public.settle_ai_chat_credits(uuid,uuid,jsonb,integer) to service_role;
notify pgrst,'reload schema';
commit;
