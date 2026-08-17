-- Retail pricing: 10 points = CNY 1 and every paid generation adds a fixed
-- CNY 1.4 profit after the complete upstream cost has been calculated.
-- Example: CNY 1.5 upstream -> ceil((1.5 + 1.4) * 10) = 29 points.

alter table public.ai_credit_accounts
  add column if not exists pricing_tier text not null default 'standard';
alter table public.ai_credit_accounts drop constraint if exists ai_credit_accounts_pricing_tier_check;
alter table public.ai_credit_accounts
  add constraint ai_credit_accounts_pricing_tier_check check (pricing_tier in ('standard', 'staff15'));

alter table public.ai_redemption_codes
  add column if not exists pricing_tier text;
alter table public.ai_redemption_codes drop constraint if exists ai_redemption_codes_pricing_tier_check;
alter table public.ai_redemption_codes
  add constraint ai_redemption_codes_pricing_tier_check check (pricing_tier is null or pricing_tier = 'staff15');

-- Only the SHA-256 digest is stored. The plaintext staff code must never be
-- included in a desktop bundle, API response, log, or analytics event.
insert into public.ai_redemption_codes
  (code_id, code_hash, credit_amount, unlocks_overseas, max_redemptions, pricing_tier, active)
values
  ('internal-staff-pricing', '49c8f3fd5b5b39253cf33a3bbcd14a270c8fbada802b1248408bdf7ccac98415', 0, false, null, 'staff15', true)
on conflict (code_id) do update set
  code_hash = excluded.code_hash,
  credit_amount = 0,
  unlocks_overseas = false,
  max_redemptions = null,
  pricing_tier = 'staff15',
  active = true;

create or replace function public.get_ai_pricing_tier(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  result text;
begin
  select pricing_tier into result
  from public.ai_credit_accounts
  where user_id = p_user_id;
  return case when result = 'staff15' then 'staff15' else 'standard' end;
end;
$$;

revoke all on function public.get_ai_pricing_tier(uuid) from public, anon, authenticated;
grant execute on function public.get_ai_pricing_tier(uuid) to service_role;

-- Reservation functions use this helper after locking the account row.  The
-- caller supplies the upstream point cost, never a pricing tier.  The tier is
-- read from the account inside SECURITY DEFINER code so a desktop request
-- cannot select or reveal the internal rate.
create or replace function public.apply_ai_pricing_tier(
  p_user_id uuid, p_standard_credits integer, p_upstream_credits numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tier text;
  upstream numeric;
begin
  select pricing_tier into tier from public.ai_credit_accounts where user_id = p_user_id;
  if tier <> 'staff15' then return p_standard_credits; end if;
  upstream := coalesce(p_upstream_credits, greatest(0, p_standard_credits - 14));
  return ceil(greatest(0, upstream) * 1.15)::integer;
end;
$$;

revoke all on function public.apply_ai_pricing_tier(uuid, integer, numeric)
  from public, anon, authenticated, service_role;

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
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid-redemption-code'); end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  select * into prior_redemption from public.ai_credit_redemptions
  where code_id = code_record.code_id and user_id = p_user_id;
  if found then
    update public.ai_credit_accounts
    set overseas_unlocked = overseas_unlocked or code_record.unlocks_overseas,
        pricing_tier = coalesce(code_record.pricing_tier, pricing_tier),
        updated_at = now()
    where user_id = p_user_id returning * into account_record;
    return jsonb_build_object(
      'ok', true, 'reason', 'already-redeemed', 'creditsAdded', 0,
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
      pricing_tier = coalesce(code_record.pricing_tier, pricing_tier),
      updated_at = now()
  where user_id = p_user_id returning * into account_record;
  insert into public.ai_credit_redemptions
    (code_id, user_id, credits_granted, unlocked_overseas)
  values (code_record.code_id, p_user_id, code_record.credit_amount, code_record.unlocks_overseas);
  update public.ai_redemption_codes set redemption_count = redemption_count + 1
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
    'ok', true, 'reason', 'redeemed', 'creditsAdded', code_record.credit_amount,
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

revoke all on function public.redeem_ai_credit_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_ai_credit_code(uuid, text) to service_role;

create or replace function public.reserve_priced_ai_credits_internal(
  p_user_id uuid,
  p_kind text,
  p_provider_id text,
  p_request_id uuid,
  p_resolution text,
  p_duration integer,
  p_expected_credits integer,
  p_quoted_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
  stale_record record;
begin
  if p_quoted_credits is null or p_quoted_credits < 0 then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if p_expected_credits is not null and p_expected_credits <> p_quoted_credits then
    return jsonb_build_object('ok', false, 'reason', 'pricing-mismatch', 'credits', p_quoted_credits);
  end if;

  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id;
  if quota_record.suspended then
    return jsonb_build_object('ok', false, 'reason', 'account-suspended');
  end if;

  for stale_record in
    select usage_row.request_id, usage_row.credits_reserved
    from public.ai_usage as usage_row
    where usage_row.user_id = p_user_id
      and usage_row.status = 'reserved'
      and usage_row.credits_reserved > 0
      and usage_row.created_at < now() - interval '30 minutes'
      and not exists (
        select 1 from public.ai_video_jobs as video_job
        where video_job.request_id = usage_row.request_id
          and video_job.status in ('starting', 'submitted', 'polling')
          and video_job.deadline_at > now()
      )
      and not exists (
        select 1 from public.ai_tool_jobs as tool_job
        where tool_job.request_id = usage_row.request_id
          and tool_job.status = 'processing'
          and tool_job.updated_at >= now() - interval '30 minutes'
      )
    order by usage_row.created_at
    for update of usage_row
  loop
    update public.ai_credit_accounts
    set reserved = greatest(0, reserved - stale_record.credits_reserved), updated_at = now()
    where user_id = p_user_id returning * into account_record;
    update public.ai_usage
    set status = 'failed', completed_at = now(), duration_ms = null
    where request_id = stale_record.request_id;
    update public.ai_tool_jobs
    set status = 'failed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where request_id = stale_record.request_id and status = 'processing';
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
       or usage_record.kind <> p_kind
       or coalesce(usage_record.provider_id, '') <> p_provider_id
       or coalesce(usage_record.resolution, '') <> coalesce(p_resolution, '')
       or usage_record.duration_seconds is distinct from p_duration
       or usage_record.credits_reserved <> p_quoted_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', false, 'reason', 'request-id-conflict', 'credits', p_quoted_credits,
      'balance', account_record.balance, 'reserved', account_record.reserved,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  if account_record.balance - account_record.reserved < p_quoted_credits then
    return jsonb_build_object(
      'ok', false, 'reason', 'insufficient-credits', 'credits', p_quoted_credits,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, p_kind, p_provider_id, p_resolution, p_duration, p_quoted_credits);

  if p_quoted_credits > 0 then
    update public.ai_credit_accounts
    set reserved = reserved + p_quoted_credits, updated_at = now()
    where user_id = p_user_id returning * into account_record;
    insert into public.ai_credit_ledger
      (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
       request_id, reference_id, idempotency_key, metadata)
    values
      (p_user_id, 'reserve', 0, p_quoted_credits, account_record.balance, account_record.reserved,
       p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
       jsonb_strip_nulls(jsonb_build_object(
         'kind', p_kind, 'providerId', p_provider_id,
         'resolution', p_resolution, 'duration', p_duration
       )))
    on conflict (user_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'reason', 'reserved', 'credits', p_quoted_credits,
    'balance', account_record.balance, 'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved
  );
end;
$$;

revoke all on function public.reserve_priced_ai_credits_internal(
  uuid, text, text, uuid, text, integer, integer, integer
) from public, anon, authenticated, service_role;

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
  upstream_credits numeric := 0;
begin
  if normalized_kind = 'chat' then
    if normalized_provider = '' then normalized_provider := 'chat-1'; end if;
    if normalized_provider !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    quoted_credits := 0;
  elsif normalized_kind = 'image' then
    if normalized_provider = '' then normalized_provider := 'image-1'; end if;
    if normalized_provider = 'image-6' then
      normalized_resolution := lower(trim(coalesce(p_resolution, 'auto')));
      if normalized_resolution not in ('low', 'medium', 'high', 'auto') then normalized_resolution := 'auto'; end if;
      quoted_credits := case normalized_resolution
        when 'low' then 16 when 'medium' then 18 when 'high' then 28 else 20 end;
    else
      quoted_credits := case normalized_provider
        when 'image-1' then 22 when 'image-2' then 20 when 'image-3' then 17
        when 'image-4' then 16 when 'image-5' then 16 else null end;
    end if;
    if quoted_credits is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    if normalized_provider = 'video-1' then
      normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '2K' then '2K' else '768P' end;
      quoted_credits := ceil((case normalized_resolution when '2K' then 8 else 5 end) * normalized_duration + 14)::integer;
    elsif normalized_provider = 'video-2' then
      normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := ceil((case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration + 14)::integer;
    elsif normalized_provider = 'video-3' then
      normalized_duration := greatest(4, least(30, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := ceil((case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration + 14)::integer;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  if normalized_kind = 'image' then
    upstream_credits := greatest(0, quoted_credits - 14);
  elsif normalized_kind = 'video' then
    upstream_credits := case normalized_provider
      when 'video-1' then (case normalized_resolution when '2K' then 8 else 5 end) * normalized_duration
      when 'video-2' then (case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration
      when 'video-3' then (case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration
      else 0
    end;
  end if;
  quoted_credits := public.apply_ai_pricing_tier(p_user_id, quoted_credits, upstream_credits);

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_nano_banana_credits(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text default null, p_duration integer default null,
  p_expected_credits integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  quoted_credits integer;
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-1', 'image-2', 'image-5', 'image-9') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_provider = 'image-1' then
    if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '2k'; end if;
    quoted_credits := case normalized_resolution when '4k' then 28 else 22 end;
  elsif normalized_provider = 'image-2' then
    if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '2k'; end if;
    quoted_credits := case normalized_resolution when '1k' then 18 when '4k' then 22 else 20 end;
  elsif normalized_provider = 'image-5' then
    normalized_resolution := 'default'; quoted_credits := 16;
  else
    normalized_resolution := 'default'; quoted_credits := 17;
  end if;
  quoted_credits := public.apply_ai_pricing_tier(
    p_user_id, quoted_credits, greatest(0, quoted_credits - 14)
  );
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_higgsfield_credits(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text default null, p_duration integer default null,
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
begin
  if lower(trim(coalesce(p_kind, ''))) <> 'image'
     or normalized_provider not in ('image-7', 'image-8') then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_resolution not in ('720p', '1080p') then normalized_resolution := '720p'; end if;
  quoted_credits := case normalized_resolution when '1080p' then 18 else 16 end;
  quoted_credits := public.apply_ai_pricing_tier(
    p_user_id, quoted_credits, greatest(0, quoted_credits - 14)
  );
  return public.reserve_priced_ai_credits_internal(
    p_user_id, 'image', normalized_provider, p_request_id,
    normalized_resolution, null, p_expected_credits, quoted_credits
  );
end;
$$;

create or replace function public.reserve_302_catalog_credits(
  p_user_id uuid, p_kind text, p_provider_id text, p_request_id uuid,
  p_resolution text default null, p_duration integer default null,
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
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  normalized_duration integer;
  quoted_credits integer;
  upstream_credits numeric := 0;
begin
  if normalized_kind = 'image' then
    if normalized_provider = 'image-3' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 18 else 17 end;
    elsif normalized_provider = 'image-10' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 21 else 18 end;
    elsif normalized_provider = 'image-11' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 18 else 17 end;
    elsif normalized_provider = 'image-12' then
      if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '1k'; end if;
      quoted_credits := case normalized_resolution when '2k' then 17 when '4k' then 18 else 16 end;
    elsif normalized_provider = 'image-13' then normalized_resolution := null; quoted_credits := 16;
    elsif normalized_provider = 'image-14' then normalized_resolution := null; quoted_credits := 16;
    elsif normalized_provider = 'image-15' then
      if normalized_resolution not in ('1k', '2k') then normalized_resolution := '1k'; end if;
      quoted_credits := case normalized_resolution when '2k' then 18 else 17 end;
    elsif normalized_provider = 'image-16' then
      if normalized_resolution not in ('512x512', '1024x1024') then normalized_resolution := '512x512'; end if;
      quoted_credits := 16;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = 'video-4' then
      normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := ceil((case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration + 14)::integer;
    elsif normalized_provider = 'video-5' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := ceil((case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration + 14)::integer;
    elsif normalized_provider = 'video-6' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case upper(trim(coalesce(p_resolution, '')))
        when '480P' then '480P' when '720P' then '720P' else '1080P' end;
      quoted_credits := ceil((case normalized_resolution when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration + 14)::integer;
    elsif normalized_provider = 'video-7' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := ceil((case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration + 14)::integer;
    elsif normalized_provider = 'video-8' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '1080P' then '1080P' else '720P' end;
      quoted_credits := ceil((case normalized_resolution when '1080P' then 1 else 0.5 end) * normalized_duration + 14)::integer;
    elsif normalized_provider = 'video-9' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := '1080P';
      quoted_credits := ceil(2 * normalized_duration + 14)::integer;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  if normalized_kind = 'image' then
    upstream_credits := greatest(0, quoted_credits - 14);
  elsif normalized_kind = 'video' then
    upstream_credits := case normalized_provider
      when 'video-4' then (case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration
      when 'video-5' then (case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration
      when 'video-6' then (case normalized_resolution when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration
      when 'video-7' then (case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration
      when 'video-8' then (case normalized_resolution when '1080P' then 1 else 0.5 end) * normalized_duration
      when 'video-9' then 2 * normalized_duration
      else 0
    end;
  end if;
  quoted_credits := public.apply_ai_pricing_tier(p_user_id, quoted_credits, upstream_credits);
  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_nano_banana_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_nano_banana_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_higgsfield_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_higgsfield_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;

alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_supported;
alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_cost_mode_check;
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_supported check (provider_id in (
    'background-remove', 'seededit-v3', 'kling-image-expand', 'cleanup', 'generative-upscale',
    'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase',
    'hunyuan3d', 'hyper3d', 'tripo3d', 'topaz-video-upscale',
    'topaz-image-sharpen', 'topaz-image-sharpen-gen',
    'topaz-image-enhance', 'topaz-image-enhance-gen', 'topaz-image-denoise',
    'topaz-image-restore', 'topaz-image-lighting'
  ));
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_cost_mode_check check (
    (provider_id like 'topaz-%' and provider_cost is not null)
    or (provider_id not like 'topaz-%' and provider_cost is null)
  );

create or replace function public.reserve_priced_ai_tool_credits_internal(
  p_user_id uuid, p_request_id uuid, p_provider_id text,
  p_provider_cost integer, p_resolution text, p_duration integer,
  p_usage_kind text, p_expected_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
  job_record public.ai_tool_jobs%rowtype;
  stale_record record;
begin
  insert into public.ai_credit_accounts (user_id) values (p_user_id) on conflict do nothing;
  select * into account_record from public.ai_credit_accounts where user_id = p_user_id for update;
  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id;
  if quota_record.suspended then return jsonb_build_object('ok', false, 'reason', 'account-suspended'); end if;

  for stale_record in
    select usage_row.request_id, usage_row.credits_reserved
    from public.ai_usage as usage_row
    join public.ai_tool_jobs as tool_job on tool_job.request_id = usage_row.request_id
    where usage_row.user_id = p_user_id
      and usage_row.status = 'reserved'
      and usage_row.credits_reserved > 0
      and tool_job.status = 'processing'
      and tool_job.updated_at < now() - interval '30 minutes'
    order by tool_job.updated_at
    for update of usage_row, tool_job
  loop
    update public.ai_credit_accounts
    set reserved = greatest(0, reserved - stale_record.credits_reserved), updated_at = now()
    where user_id = p_user_id returning * into account_record;
    update public.ai_usage set status = 'failed', completed_at = now(), duration_ms = null
    where request_id = stale_record.request_id;
    update public.ai_tool_jobs
    set status = 'failed', completed_at = coalesce(completed_at, now()), updated_at = now()
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
    select * into job_record from public.ai_tool_jobs where request_id = p_request_id;
    if usage_record.user_id <> p_user_id
       or usage_record.kind <> p_usage_kind
       or coalesce(usage_record.provider_id, '') <> p_provider_id
       or coalesce(usage_record.resolution, '') <> coalesce(p_resolution, '')
       or usage_record.duration_seconds is distinct from p_duration
       or usage_record.credits_reserved <> p_expected_credits
       or not found
       or job_record.provider_cost is distinct from p_provider_cost
       or job_record.retail_credits <> p_expected_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', usage_record.status = 'reserved' and job_record.status = 'processing',
      'reason', case when usage_record.status = 'reserved' and job_record.status = 'processing'
        then 'already-reserved' else 'request-id-conflict' end,
      'credits', p_expected_credits, 'providerCost', p_provider_cost,
      'balance', account_record.balance, 'reserved', account_record.reserved,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  if account_record.balance - account_record.reserved < p_expected_credits then
    return jsonb_build_object(
      'ok', false, 'reason', 'insufficient-credits', 'credits', p_expected_credits,
      'providerCost', p_provider_cost,
      'availableCredits', account_record.balance - account_record.reserved
    );
  end if;

  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values
    (p_request_id, p_user_id, p_usage_kind, p_provider_id,
     p_resolution, p_duration, p_expected_credits);
  insert into public.ai_tool_jobs
    (request_id, user_id, provider_id, provider_cost, retail_credits)
  values
    (p_request_id, p_user_id, p_provider_id, p_provider_cost, p_expected_credits);
  update public.ai_credit_accounts
  set reserved = reserved + p_expected_credits, updated_at = now()
  where user_id = p_user_id returning * into account_record;
  insert into public.ai_credit_ledger
    (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
     request_id, reference_id, idempotency_key, metadata)
  values
    (p_user_id, 'reserve', 0, p_expected_credits, account_record.balance, account_record.reserved,
     p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
     jsonb_strip_nulls(jsonb_build_object(
       'kind', p_usage_kind, 'providerId', p_provider_id,
       'providerCost', p_provider_cost, 'retailCredits', p_expected_credits,
       'resolution', p_resolution, 'duration', p_duration
     )))
  on conflict (user_id, idempotency_key) do nothing;
  return jsonb_build_object(
    'ok', true, 'reason', 'reserved', 'credits', p_expected_credits,
    'providerCost', p_provider_cost, 'balance', account_record.balance,
    'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved
  );
end;
$$;

revoke all on function public.reserve_priced_ai_tool_credits_internal(
  uuid, uuid, text, integer, text, integer, text, integer
) from public, anon, authenticated, service_role;

create or replace function public.reserve_ai_tool_credits(
  p_user_id uuid, p_request_id uuid, p_provider_id text,
  p_credits integer, p_provider_cost integer,
  p_resolution text default null, p_duration integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  normalized_resolution text := nullif(left(trim(coalesce(p_resolution, '')), 32), '');
  normalized_duration integer := case when p_duration is null then null else greatest(1, least(21600, p_duration)) end;
  usage_kind text;
  expected_credits integer;
  upstream_credits numeric;
begin
  usage_kind := case
    when normalized_provider = 'topaz-video-upscale' then 'video'
    when normalized_provider in ('hunyuan3d', 'hyper3d', 'tripo3d') then '3d'
    when normalized_provider in (
      'background-remove', 'seededit-v3', 'kling-image-expand', 'cleanup', 'generative-upscale',
      'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase'
    ) then 'image'
    else null
  end;
  expected_credits := case normalized_provider
    when 'background-remove' then 48
    when 'seededit-v3' then 18
    when 'kling-image-expand' then 17
    when 'cleanup' then 48
    when 'generative-upscale' then 69
    when 'qwen-image-edit-plus' then 2
    when 'qwen-image-layered' then 1
    when 'super-upscale-v2' then 2
    when 'erase' then 1
    when 'hunyuan3d' then 22
    when 'hyper3d' then 28
    when 'tripo3d' then 24
    when 'topaz-video-upscale' then
      case when p_provider_cost between 0 and 1000000
        then ceil((p_provider_cost::numeric * 6.8 + 1.4) * 10)::integer else null end
    else null
  end;
  upstream_credits := case normalized_provider
    when 'background-remove' then 34
    when 'seededit-v3' then 3.4
    when 'kling-image-expand' then 2.72
    when 'cleanup' then 34
    when 'generative-upscale' then 54.4
    when 'hunyuan3d' then 8
    when 'hyper3d' then 14
    when 'tripo3d' then 10
    when 'topaz-video-upscale' then p_provider_cost::numeric * 6.8 * 10
    else expected_credits::numeric / 1.15
  end;
  expected_credits := public.apply_ai_pricing_tier(
    p_user_id, expected_credits, upstream_credits
  );
  if usage_kind is null or expected_credits is null
     or p_credits is null or p_credits <> expected_credits
     or p_credits < 0 or p_credits > 3000000
     or (normalized_provider = 'topaz-video-upscale' and p_provider_cost is null)
     or (normalized_provider <> 'topaz-video-upscale' and p_provider_cost is not null) then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  return public.reserve_priced_ai_tool_credits_internal(
    p_user_id, p_request_id, normalized_provider, p_provider_cost,
    normalized_resolution, normalized_duration, usage_kind, expected_credits
  );
end;
$$;

create or replace function public.reserve_topaz_image_credits(
  p_user_id uuid, p_request_id uuid, p_provider_id text,
  p_credits integer, p_provider_cost integer,
  p_resolution text default null, p_duration integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  expected_credits integer;
begin
  if normalized_provider not in (
    'topaz-image-sharpen', 'topaz-image-sharpen-gen',
    'topaz-image-enhance', 'topaz-image-enhance-gen', 'topaz-image-denoise',
    'topaz-image-restore', 'topaz-image-lighting'
  ) or p_provider_cost is null or p_provider_cost < 0 or p_provider_cost > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  expected_credits := ceil((p_provider_cost::numeric * 6.8 + 1.4) * 10)::integer;
  expected_credits := public.apply_ai_pricing_tier(
    p_user_id, expected_credits, p_provider_cost::numeric * 6.8 * 10
  );
  if p_credits is null or p_credits <> expected_credits then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  return public.reserve_priced_ai_tool_credits_internal(
    p_user_id, p_request_id, normalized_provider, p_provider_cost,
    null, null, 'image', expected_credits
  );
end;
$$;

revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;
revoke all on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;
