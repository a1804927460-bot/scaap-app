-- Add Seedance 2.0 and 2.5 video pricing after the asynchronous video-job
-- migration. The live-video exclusion below must remain in every later
-- reserve_ai_credits replacement so active jobs keep their reservations.

-- The original asynchronous job table only accepted MiniMax resolutions.
-- Broaden the persisted job constraint before Seedance reservations can be
-- inserted, while retaining the complete MiniMax allowlist.
alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_resolution_check;
alter table public.ai_video_jobs
  add constraint ai_video_jobs_resolution_check
  check (resolution in ('480P', '720P', '768P', '2K'));

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
    if normalized_provider = 'image-6' then
      normalized_resolution := lower(trim(coalesce(p_resolution, 'auto')));
      if normalized_resolution not in ('low', 'medium', 'high', 'auto') then
        normalized_resolution := 'auto';
      end if;
      quoted_credits := case normalized_resolution
        when 'low' then 3
        when 'medium' then 8
        when 'high' then 28
        else 12
      end;
    else
      quoted_credits := case normalized_provider
        when 'image-1' then 16
        when 'image-2' then 7
        when 'image-3' then 5
        when 'image-4' then 4
        when 'image-5' then 8
        else null
      end;
    end if;
    if quoted_credits is null then
      return jsonb_build_object('ok', false, 'reason', 'provider-not-allowed');
    end if;
  elsif normalized_kind = 'video' then
    if normalized_provider = '' then normalized_provider := 'video-1'; end if;
    normalized_duration := greatest(4, least(15, coalesce(p_duration, 6)));
    if normalized_provider = 'video-1' then
      normalized_resolution := case
        when upper(trim(coalesce(p_resolution, '768P'))) = '2K' then '2K'
        else '768P'
      end;
      quoted_credits := (case normalized_resolution when '2K' then 16 else 10 end) * normalized_duration;
    elsif normalized_provider = 'video-2' then
      normalized_resolution := case
        when upper(trim(coalesce(p_resolution, '720P'))) = '480P' then '480P'
        else '720P'
      end;
      quoted_credits := (case normalized_resolution when '480P' then 3 else 5 end) * normalized_duration;
    elsif normalized_provider = 'video-3' then
      normalized_resolution := case
        when upper(trim(coalesce(p_resolution, '720P'))) = '480P' then '480P'
        else '720P'
      end;
      quoted_credits := (case normalized_resolution when '480P' then 4 else 6 end) * normalized_duration;
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

  for stale_record in
    select usage_row.request_id, usage_row.credits_reserved
    from public.ai_usage as usage_row
    where usage_row.user_id = p_user_id
      and usage_row.status = 'reserved'
      and usage_row.credits_reserved > 0
      and usage_row.created_at < now() - interval '30 minutes'
      and not exists (
        select 1
        from public.ai_video_jobs as video_job
        where video_job.request_id = usage_row.request_id
          and video_job.status in ('starting', 'submitted', 'polling')
          and video_job.deadline_at > now()
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
       or coalesce(usage_record.resolution, '') <> coalesce(normalized_resolution, '')
       or usage_record.credits_reserved <> quoted_credits then
      return jsonb_build_object('ok', false, 'reason', 'request-id-conflict');
    end if;
    return jsonb_build_object(
      'ok', false,
      'reason', 'request-id-conflict',
      'credits', quoted_credits,
      'balance', account_record.balance,
      'reserved', account_record.reserved,
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
