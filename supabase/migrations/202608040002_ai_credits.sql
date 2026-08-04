-- Server-authoritative credits and overseas-model activation for Messs.
-- Apply after 202608030001_gateway_security.sql. Only SHA-256 hashes are
-- stored for redemption codes; plaintext codes must never enter the database,
-- application source, logs, or analytics.

create table if not exists public.ai_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= balance),
  overseas_unlocked boolean not null default false,
  membership_tier text not null default 'free' check (char_length(membership_tier) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('grant', 'reserve', 'charge', 'release', 'expire', 'adjustment')),
  balance_delta integer not null default 0,
  reserved_delta integer not null default 0,
  balance_after integer not null check (balance_after >= 0),
  reserved_after integer not null check (reserved_after >= 0),
  request_id uuid,
  reference_id text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (balance_delta <> 0 or reserved_delta <> 0),
  unique (user_id, idempotency_key)
);

create index if not exists ai_credit_ledger_user_created_idx
  on public.ai_credit_ledger (user_id, created_at desc);
create index if not exists ai_credit_ledger_request_idx
  on public.ai_credit_ledger (request_id) where request_id is not null;

create table if not exists public.ai_redemption_codes (
  code_id text primary key,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  credit_amount integer not null default 0 check (credit_amount >= 0),
  unlocks_overseas boolean not null default true,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_credit_redemptions (
  id bigint generated always as identity primary key,
  code_id text not null references public.ai_redemption_codes(code_id),
  user_id uuid not null references auth.users(id) on delete cascade,
  credits_granted integer not null default 0 check (credits_granted >= 0),
  unlocked_overseas boolean not null default false,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

create index if not exists ai_credit_redemptions_user_idx
  on public.ai_credit_redemptions (user_id, redeemed_at desc);

alter table public.ai_usage add column if not exists provider_id text;
alter table public.ai_usage add column if not exists resolution text;
alter table public.ai_usage add column if not exists duration_seconds integer;
alter table public.ai_usage add column if not exists credits_reserved integer not null default 0;
alter table public.ai_usage add column if not exists credits_charged integer not null default 0;

do $$
begin
  alter table public.ai_usage
    add constraint ai_usage_credits_nonnegative
    check (credits_reserved >= 0 and credits_charged >= 0 and credits_charged <= credits_reserved);
exception when duplicate_object then null;
end;
$$;

alter table public.ai_credit_accounts enable row level security;
alter table public.ai_credit_ledger enable row level security;
alter table public.ai_redemption_codes enable row level security;
alter table public.ai_credit_redemptions enable row level security;

drop policy if exists "credit_accounts_select_own" on public.ai_credit_accounts;
create policy "credit_accounts_select_own" on public.ai_credit_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "credit_ledger_select_own" on public.ai_credit_ledger;
create policy "credit_ledger_select_own" on public.ai_credit_ledger
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "credit_redemptions_select_own" on public.ai_credit_redemptions;
create policy "credit_redemptions_select_own" on public.ai_credit_redemptions
  for select to authenticated using ((select auth.uid()) = user_id);

-- No client mutation policies are created. Railway's service key is the only
-- credential permitted to invoke the definer RPCs below.

insert into public.ai_redemption_codes
  (code_id, code_hash, credit_amount, unlocks_overseas, max_redemptions)
values
  ('owner-access', '1083767bbed23a69343cd7a8898907a12780e34eb11936b6482804fc810f9614', 0, true, null),
  ('beta-01', '0c781c055e478e20beb10eb2119c2e7fa147f7fcb2ca8630b08c7508c7c4d2cf', 100, true, 1),
  ('beta-02', '301879aa480616dfab6c7ba930b9abff28db809315a058b3c78c726c05647299', 100, true, 1),
  ('beta-03', '81605b41aac5c9a2f30757eca962a1f62eeab6175aaea0438d5b8ac498ef218c', 100, true, 1),
  ('beta-04', '0cbe7529004102a4a3398189081ea4573139403d326a97781868f9eb276037f4', 100, true, 1),
  ('beta-05', 'ecfd5f325937693007da4ce734c9374fa7066c585ad7db620d247eb8087c8d1f', 100, true, 1),
  ('beta-06', '6864748624a8fed5215970e0a281139ad71b9d436e82482681606d23b288b939', 100, true, 1),
  ('beta-07', 'dce2c20d3f07132931dd98ccb5f62100ecc273167a3ac3be978c5a15f8ac0b9f', 100, true, 1),
  ('beta-08', '9452d13cfc2b14a447ed7dfa2f122ab80cb26d5d6c3844f8fc056fc140594e0e', 100, true, 1),
  ('beta-09', '989b7ed8fa242a5e30801b8234949013d79a4210e4693180a0a956fbef6054dd', 100, true, 1),
  ('beta-10', 'b2eb826636a3aa86d032aeacb094aa5a62f297269b26f26c77df60ba69b96737', 100, true, 1)
on conflict (code_id) do update set
  code_hash = excluded.code_hash,
  credit_amount = excluded.credit_amount,
  unlocks_overseas = excluded.unlocks_overseas,
  max_redemptions = excluded.max_redemptions,
  active = true;

insert into public.ai_credit_accounts (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_messs_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.ai_quotas (user_id) values (new.id) on conflict do nothing;
  insert into public.ai_credit_accounts (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create or replace function public.get_ai_credit_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_record public.ai_credit_accounts%rowtype;
begin
  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id;
  return jsonb_build_object(
    'balance', account_record.balance,
    'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved,
    'overseasUnlocked', account_record.overseas_unlocked,
    'membershipTier', account_record.membership_tier,
    'updatedAt', account_record.updated_at
  );
end;
$$;

create or replace function public.redeem_ai_credit_code(p_user_id uuid, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code_record public.ai_redemption_codes%rowtype;
  account_record public.ai_credit_accounts%rowtype;
  prior_redemption public.ai_credit_redemptions%rowtype;
begin
  select * into code_record
  from public.ai_redemption_codes
  where code_hash = lower(trim(coalesce(p_code_hash, ''))) and active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid-redemption-code');
  end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;

  select * into prior_redemption
  from public.ai_credit_redemptions
  where code_id = code_record.code_id and user_id = p_user_id;
  if found then
    if code_record.unlocks_overseas and not account_record.overseas_unlocked then
      update public.ai_credit_accounts
      set overseas_unlocked = true, updated_at = now()
      where user_id = p_user_id returning * into account_record;
    end if;
    return jsonb_build_object(
      'ok', true,
      'reason', 'already-redeemed',
      'creditsAdded', 0,
      'account', jsonb_build_object(
        'balance', account_record.balance,
        'reserved', account_record.reserved,
        'availableCredits', account_record.balance - account_record.reserved,
        'overseasUnlocked', account_record.overseas_unlocked,
        'membershipTier', account_record.membership_tier
      )
    );
  end if;

  if code_record.max_redemptions is not null
     and code_record.redemption_count >= code_record.max_redemptions then
    return jsonb_build_object('ok', false, 'reason', 'code-exhausted');
  end if;

  update public.ai_credit_accounts
  set balance = balance + code_record.credit_amount,
      overseas_unlocked = overseas_unlocked or code_record.unlocks_overseas,
      updated_at = now()
  where user_id = p_user_id
  returning * into account_record;

  insert into public.ai_credit_redemptions
    (code_id, user_id, credits_granted, unlocked_overseas)
  values
    (code_record.code_id, p_user_id, code_record.credit_amount, code_record.unlocks_overseas);

  update public.ai_redemption_codes
  set redemption_count = redemption_count + 1
  where code_id = code_record.code_id;

  if code_record.credit_amount > 0 then
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'grant', code_record.credit_amount, 0, account_record.balance,
       account_record.reserved, code_record.code_id,
       'redemption:' || code_record.code_id || ':' || p_user_id::text,
       jsonb_build_object('codeId', code_record.code_id));
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'redeemed',
    'creditsAdded', code_record.credit_amount,
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
  activation_required boolean := true;
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
    activation_required := false;
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

  -- A gateway request is capped at 20 minutes. Releasing reservations older
  -- than 30 minutes protects users from permanently locked credits after a
  -- Railway restart while never releasing a live request.
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
    if usage_record.status = 'reserved' then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict', 'credits', quoted_credits,
        'balance', account_record.balance, 'reserved', account_record.reserved,
        'availableCredits', account_record.balance - account_record.reserved);
    elsif usage_record.status = 'succeeded' then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict', 'credits', quoted_credits,
        'balance', account_record.balance, 'reserved', account_record.reserved,
        'availableCredits', account_record.balance - account_record.reserved);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
  end if;

  if activation_required and not account_record.overseas_unlocked then
    return jsonb_build_object('ok', false, 'reason', 'activation-required', 'credits', quoted_credits,
      'availableCredits', account_record.balance - account_record.reserved);
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
begin
  select user_id into target_user_id from public.ai_usage where request_id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;

  select * into account_record from public.ai_credit_accounts where user_id = target_user_id for update;
  select * into usage_record from public.ai_usage where request_id = p_request_id for update;

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

revoke all on function public.get_ai_credit_account(uuid) from public, anon, authenticated;
revoke all on function public.redeem_ai_credit_code(uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.settle_ai_credits(uuid, text, integer) from public, anon, authenticated;

grant execute on function public.get_ai_credit_account(uuid) to service_role;
grant execute on function public.redeem_ai_credit_code(uuid, text) to service_role;
grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer) to service_role;
grant execute on function public.settle_ai_credits(uuid, text, integer) to service_role;

revoke all on function public.handle_new_messs_user() from public, anon, authenticated;
