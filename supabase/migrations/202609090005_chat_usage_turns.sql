-- Recompute multi-response chat charges at each response's actual context tier.
begin;
create or replace function public.quote_ai_chat_receipt_credits(p_receipt jsonb)
returns numeric language plpgsql immutable set search_path=public as $$
declare
  item jsonb; rate jsonb; turns jsonb; input_count bigint; output_count bigint; cached_count bigint;
  sum_input bigint:=0; sum_output bigint:=0; sum_cached bigint:=0;
  input_rate numeric; output_rate numeric; cache_rate numeric; cost numeric:=0;
begin
  if nullif(p_receipt#>>'{rate,source}','') is null or nullif(p_receipt#>>'{rate,verifiedAt}','') is null then return null; end if;
  turns:=coalesce(p_receipt->'turns',jsonb_build_array(p_receipt->'usage'));
  if jsonb_typeof(turns)<>'array' or jsonb_array_length(turns) not between 1 and 5 then return null; end if;
  for item in select value from jsonb_array_elements(turns) loop
    input_count:=(item->>'inputTokens')::bigint; output_count:=(item->>'outputTokens')::bigint;
    cached_count:=coalesce((item->>'cachedInputTokens')::bigint,0);
    if input_count is null or output_count is null or input_count<0 or output_count<0 or cached_count<0 or cached_count>input_count
      or coalesce((item->>'cacheCreationTokens')::bigint,0)<>0 then return null; end if;
    rate:=p_receipt->'rate';
    if input_count>coalesce((rate#>>'{longContext,aboveInputTokens}')::bigint,9223372036854775807) then rate:=rate->'longContext'; end if;
    input_rate:=(rate->>'inputCnyPerMillion')::numeric; output_rate:=(rate->>'outputCnyPerMillion')::numeric;
    cache_rate:=case when cached_count=0 then 0 else (rate->>'cachedInputCnyPerMillion')::numeric end;
    if input_rate is null or output_rate is null or cache_rate is null or least(input_rate,output_rate,cache_rate)<0 then return null; end if;
    cost:=cost+(input_count-cached_count)*input_rate+cached_count*cache_rate+output_count*output_rate;
    sum_input:=sum_input+input_count; sum_output:=sum_output+output_count; sum_cached:=sum_cached+cached_count;
  end loop;
  if sum_input is distinct from (p_receipt#>>'{usage,inputTokens}')::bigint
     or sum_output is distinct from (p_receipt#>>'{usage,outputTokens}')::bigint
     or sum_cached<>coalesce((p_receipt#>>'{usage,cachedInputTokens}')::bigint,0) then return null; end if;
  return ceil(cost*120/70000)/100;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$$;
revoke all on function public.quote_ai_chat_receipt_credits(jsonb) from public,anon,authenticated;
grant execute on function public.quote_ai_chat_receipt_credits(jsonb) to service_role;

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
    expected := public.quote_ai_chat_receipt_credits(p_receipt);
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
notify pgrst, 'reload schema';
commit;
