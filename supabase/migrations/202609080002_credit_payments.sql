-- Server-owned checkout intents. A redirect or client amount never grants credits.
create table public.credit_payments (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  pack text not null check (pack in ('start','create','studio')),
  product text not null,
  amount integer not null check (amount > 0),
  currency text not null check (currency = 'USD'),
  credits integer not null check (credits > 0),
  checkout text unique,
  provider_order text unique,
  event_id text unique,
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index credit_payments_user_created on public.credit_payments(user_id, created_at desc);
alter table public.credit_payments enable row level security;
revoke all on public.credit_payments from anon, authenticated;
grant all on public.credit_payments to service_role;

create table public.credit_payment_reviews (
  event_id text primary key,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.credit_payment_reviews enable row level security;
revoke all on public.credit_payment_reviews from anon, authenticated;
grant all on public.credit_payment_reviews to service_role;

create function public.create_credit_payment(p_id uuid, p_user_id uuid, p_pack text,
  p_product text, p_amount integer, p_currency text, p_credits integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not ((p_pack='start' and p_amount=959 and p_credits=1000)
    or (p_pack='create' and p_amount=2877 and p_credits=3000)
    or (p_pack='studio' and p_amount=9589 and p_credits=10000))
    or p_currency <> 'USD' or p_product not like 'prod_%' then
    raise exception 'invalid payment pack';
  end if;
  insert into credit_payments(id,user_id,pack,product,amount,currency,credits)
    values(p_id,p_user_id,p_pack,p_product,p_amount,p_currency,p_credits);
  return jsonb_build_object('ok',true);
end $$;

create function public.attach_credit_checkout(p_id uuid, p_checkout text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare payment credit_payments;
begin
  select * into strict payment from credit_payments where id=p_id for update;
  if payment.checkout is not null and payment.checkout <> p_checkout then raise exception 'checkout mismatch'; end if;
  update credit_payments set checkout=p_checkout where id=p_id;
  return jsonb_build_object('ok',true);
end $$;

create function public.complete_credit_payment(p_id uuid, p_event_id text, p_checkout text,
  p_order text, p_product text, p_amount integer, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare payment credit_payments; account ai_credit_accounts;
begin
  select * into strict payment from credit_payments where id=p_id for update;
  if payment.product <> p_product or payment.amount <> p_amount or payment.currency <> p_currency
    or (payment.checkout is not null and payment.checkout <> p_checkout)
    or p_checkout not like 'ch_%' or p_order not like 'ord_%' then raise exception 'payment mismatch'; end if;
  if payment.status='paid' then
    if payment.provider_order <> p_order then raise exception 'order mismatch'; end if;
    return jsonb_build_object('ok',true,'duplicate',true);
  end if;
  insert into ai_credit_accounts(user_id) values(payment.user_id) on conflict do nothing;
  select * into strict account from ai_credit_accounts where user_id=payment.user_id for update;
  update ai_credit_accounts set balance=balance+payment.credits, updated_at=now()
    where user_id=payment.user_id returning * into account;
  insert into ai_credit_ledger(user_id,event_type,balance_delta,balance_after,reserved_after,reference_id,idempotency_key,metadata)
    values(payment.user_id,'grant',payment.credits,account.balance,account.reserved,p_order,
      'creem:'||p_order,jsonb_build_object('payment_id',p_id,'pack',payment.pack,'amount',p_amount,'currency',p_currency));
  update credit_payments set status='paid',checkout=p_checkout,provider_order=p_order,event_id=p_event_id,paid_at=now() where id=p_id;
  return jsonb_build_object('ok',true,'credits',payment.credits);
end $$;

create function public.record_credit_payment_review(p_event_id text,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into credit_payment_reviews(event_id,kind,payload) values(p_event_id,p_kind,p_payload) on conflict do nothing;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.create_credit_payment(uuid,uuid,text,text,integer,text,integer) from public,anon,authenticated;
revoke all on function public.attach_credit_checkout(uuid,text) from public,anon,authenticated;
revoke all on function public.complete_credit_payment(uuid,text,text,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.record_credit_payment_review(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_credit_payment(uuid,uuid,text,text,integer,text,integer) to service_role;
grant execute on function public.attach_credit_checkout(uuid,text) to service_role;
grant execute on function public.complete_credit_payment(uuid,text,text,text,text,integer,text) to service_role;
grant execute on function public.record_credit_payment_review(text,text,jsonb) to service_role;
