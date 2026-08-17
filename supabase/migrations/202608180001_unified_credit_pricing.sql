-- One public price applies to every account. Video has a 30-point minimum so
-- a paid video request can never be quoted below the highest image tier.

update public.ai_credit_accounts
set pricing_tier = 'standard', updated_at = now()
where pricing_tier is distinct from 'standard';

update public.ai_redemption_codes
set active = false, pricing_tier = null
where pricing_tier is not null or code_id = 'internal-staff-pricing';

alter table public.ai_credit_accounts
  drop constraint if exists ai_credit_accounts_pricing_tier_check;
alter table public.ai_credit_accounts
  add constraint ai_credit_accounts_pricing_tier_check
  check (pricing_tier = 'standard');

alter table public.ai_redemption_codes
  drop constraint if exists ai_redemption_codes_pricing_tier_check;
alter table public.ai_redemption_codes
  add constraint ai_redemption_codes_pricing_tier_check
  check (pricing_tier is null);

create or replace function public.get_ai_pricing_tier(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'standard';
end;
$$;

create or replace function public.apply_ai_pricing_tier(
  p_user_id uuid, p_standard_credits integer, p_upstream_credits numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return greatest(0, coalesce(p_standard_credits, 0));
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
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '2K' then 8 else 5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-2' then
      normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-3' then
      normalized_duration := greatest(4, least(30, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration + 14)::integer
      );
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
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
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-5' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 2 else 3 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-6' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case upper(trim(coalesce(p_resolution, '')))
        when '480P' then '480P' when '720P' then '720P' else '1080P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 2 when '720P' then 3 else 4 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-7' then
      normalized_duration := greatest(2, least(12, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '480P' then '480P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '480P' then 1.5 else 2.5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-8' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := case when upper(trim(coalesce(p_resolution, ''))) = '1080P' then '1080P' else '720P' end;
      quoted_credits := greatest(30,
        ceil((case normalized_resolution when '1080P' then 1 else 0.5 end) * normalized_duration + 14)::integer
      );
    elsif normalized_provider = 'video-9' then
      normalized_duration := greatest(5, least(10, coalesce(p_duration, 6)));
      normalized_resolution := '1080P';
      quoted_credits := greatest(30, ceil(2 * normalized_duration + 14)::integer);
    else
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
  end if;

  return public.reserve_priced_ai_credits_internal(
    p_user_id, normalized_kind, normalized_provider, p_request_id,
    normalized_resolution, normalized_duration, p_expected_credits, quoted_credits
  );
end;
$$;

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
    when 'kling-image-expand' then 48
    when 'cleanup' then 48
    when 'generative-upscale' then 69
    when 'qwen-image-edit-plus' then 16
    when 'qwen-image-layered' then 16
    when 'super-upscale-v2' then 16
    when 'erase' then 16
    when 'hunyuan3d' then 22
    when 'hyper3d' then 28
    when 'tripo3d' then 24
    when 'topaz-video-upscale' then
      case when p_provider_cost between 0 and 1000000
        then ceil((p_provider_cost::numeric * 6.8 + 1.4) * 10)::integer else null end
    else null
  end;
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

revoke all on function public.get_ai_pricing_tier(uuid) from public, anon, authenticated;
grant execute on function public.get_ai_pricing_tier(uuid) to service_role;
revoke all on function public.apply_ai_pricing_tier(uuid, integer, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_302_catalog_credits(uuid, text, text, uuid, text, integer, integer)
  to service_role;
revoke all on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_tool_credits(uuid, uuid, text, integer, integer, text, integer)
  to service_role;

notify pgrst, 'reload schema';
