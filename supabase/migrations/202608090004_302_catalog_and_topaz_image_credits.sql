-- Authoritative pricing for the expanded 302 media catalog and Topaz image tools.

create or replace function public.reserve_302_catalog_credits(
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
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  normalized_duration integer;
  quoted_credits integer;
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
begin
  if normalized_kind = 'image' then
    if normalized_provider = 'image-3' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 8 else 5 end;
    elsif normalized_provider = 'image-10' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 14 else 8 end;
    elsif normalized_provider = 'image-11' then
      if normalized_resolution not in ('2k', '4k') then normalized_resolution := '2k'; end if;
      quoted_credits := case normalized_resolution when '4k' then 8 else 5 end;
    elsif normalized_provider = 'image-12' then
      if normalized_resolution not in ('1k', '2k', '4k') then normalized_resolution := '1k'; end if;
      quoted_credits := case normalized_resolution when '2k' then 5 when '4k' then 8 else 4 end;
    elsif normalized_provider = 'image-13' then
      normalized_resolution := null;
      quoted_credits := 3;
    elsif normalized_provider = 'image-14' then
      normalized_resolution := null;
      quoted_credits := 4;
    elsif normalized_provider = 'image-15' then
      if normalized_resolution not in ('1k', '2k') then normalized_resolution := '1k'; end if;
      quoted_credits := case normalized_resolution when '2k' then 8 else 5 end;
    elsif normalized_provider = 'image-16' then
      if normalized_resolution not in ('512x512', '1024x1024') then normalized_resolution := '512x512'; end if;
      quoted_credits := case normalized_resolution when '1024x1024' then 4 else 3 end;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
    normalized_duration := null;
  elsif normalized_kind = 'video' then
    if normalized_provider = 'video-4' then
      normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := (case normalized_resolution when '480P' then 3 else 5 end) * normalized_duration;
    elsif normalized_provider = 'video-5' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := (case normalized_resolution when '480P' then 4 else 6 end) * normalized_duration;
    elsif normalized_provider = 'video-6' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case upper(trim(coalesce(p_resolution, '')))
        when '480P' then '480P' when '720P' then '720P' else '1080P' end;
      quoted_credits := (case normalized_resolution when '480P' then 4 when '720P' then 6 else 8 end) * normalized_duration;
    elsif normalized_provider = 'video-7' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := (case normalized_resolution when '480P' then 3 else 5 end) * normalized_duration;
    elsif normalized_provider = 'video-8' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '1080P' then '1080P' else '720P' end;
      quoted_credits := (case normalized_resolution when '1080P' then 2 else 1 end) * normalized_duration;
    elsif normalized_provider = 'video-9' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := '1080P';
      quoted_credits := 4 * normalized_duration;
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
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
  select * into usage_record from public.ai_usage where request_id = p_request_id for update;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'request-id-conflict', 'credits', quoted_credits,
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
                        'resolution', normalized_resolution, 'duration', normalized_duration))
  on conflict (user_id, idempotency_key) do nothing;
  return jsonb_build_object('ok', true, 'reason', 'reserved', 'credits', quoted_credits,
    'balance', account_record.balance, 'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved);
end;
$$;

revoke all on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;

alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_supported;
alter table public.ai_tool_jobs drop constraint if exists ai_tool_jobs_provider_cost_mode_check;
alter table public.ai_tool_jobs
  add constraint ai_tool_jobs_provider_supported check (provider_id in (
    'background-remove', 'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase',
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

create or replace function public.reserve_topaz_image_credits(
  p_user_id uuid,
  p_request_id uuid,
  p_provider_id text,
  p_credits integer,
  p_provider_cost integer,
  p_resolution text default null,
  p_duration integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider_id, '')));
  expected_credits integer;
  account_record public.ai_credit_accounts%rowtype;
  quota_record public.ai_quotas%rowtype;
  usage_record public.ai_usage%rowtype;
begin
  if normalized_provider not in (
    'topaz-image-sharpen', 'topaz-image-sharpen-gen',
    'topaz-image-enhance', 'topaz-image-enhance-gen', 'topaz-image-denoise',
    'topaz-image-restore', 'topaz-image-lighting'
  ) or p_provider_cost is null or p_provider_cost < 0 or p_provider_cost > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;
  expected_credits := ceil(p_provider_cost::numeric * 0.15 * 10 * 2)::integer;
  if p_credits is null or p_credits <> expected_credits then
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
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
    return jsonb_build_object('ok', false, 'reason', 'request-id-conflict', 'credits', expected_credits,
      'providerCost', p_provider_cost, 'availableCredits', account_record.balance - account_record.reserved);
  end if;
  if account_record.balance - account_record.reserved < expected_credits then
    return jsonb_build_object('ok', false, 'reason', 'insufficient-credits', 'credits', expected_credits,
      'providerCost', p_provider_cost, 'availableCredits', account_record.balance - account_record.reserved);
  end if;
  insert into public.ai_usage
    (request_id, user_id, kind, provider_id, resolution, duration_seconds, credits_reserved)
  values (p_request_id, p_user_id, 'image', normalized_provider, null, null, expected_credits);
  insert into public.ai_tool_jobs
    (request_id, user_id, provider_id, provider_cost, retail_credits)
  values (p_request_id, p_user_id, normalized_provider, p_provider_cost, expected_credits);
  update public.ai_credit_accounts
  set reserved = reserved + expected_credits, updated_at = now()
  where user_id = p_user_id returning * into account_record;
  insert into public.ai_credit_ledger
    (user_id, event_type, balance_delta, reserved_delta, balance_after, reserved_after,
     request_id, reference_id, idempotency_key, metadata)
  values
    (p_user_id, 'reserve', 0, expected_credits, account_record.balance, account_record.reserved,
     p_request_id, p_request_id::text, 'reserve:' || p_request_id::text,
     jsonb_build_object('kind', 'image', 'providerId', normalized_provider,
                        'providerCost', p_provider_cost, 'retailCredits', expected_credits))
  on conflict (user_id, idempotency_key) do nothing;
  return jsonb_build_object('ok', true, 'reason', 'reserved', 'credits', expected_credits,
    'providerCost', p_provider_cost, 'balance', account_record.balance,
    'reserved', account_record.reserved,
    'availableCredits', account_record.balance - account_record.reserved);
end;
$$;

revoke all on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_topaz_image_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;
