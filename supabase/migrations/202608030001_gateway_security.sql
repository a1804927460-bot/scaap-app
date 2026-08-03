-- Messs cloud identity, durable AI quotas, and server-only usage records.
-- Run this in the Supabase SQL editor for project trmbhcniijedpmohkbzx.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_chat integer not null default 100 check (daily_chat between 0 and 10000),
  daily_image integer not null default 20 check (daily_image between 0 and 1000),
  daily_video integer not null default 5 check (daily_video between 0 and 100),
  suspended boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('chat', 'image', 'video')),
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'failed')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_usage_user_created_idx
  on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_user_kind_created_idx
  on public.ai_usage (user_id, kind, created_at desc);

alter table public.profiles enable row level security;
alter table public.ai_quotas enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "quotas_select_own" on public.ai_quotas;
create policy "quotas_select_own" on public.ai_quotas
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "usage_select_own" on public.ai_usage;
create policy "usage_select_own" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);

-- There are deliberately no client INSERT/UPDATE/DELETE policies for quotas
-- or usage. Only the Railway gateway's Supabase secret key may mutate them.

create or replace function public.handle_new_messs_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.ai_quotas (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_messs on auth.users;
create trigger on_auth_user_created_messs
  after insert on auth.users
  for each row execute procedure public.handle_new_messs_user();

create or replace function public.reserve_ai_request(
  p_user_id uuid,
  p_kind text,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  quota_record public.ai_quotas%rowtype;
  daily_limit integer;
  used_today integer;
begin
  if p_kind not in ('chat', 'image', 'video') then return false; end if;

  insert into public.ai_quotas (user_id) values (p_user_id) on conflict do nothing;
  select * into quota_record from public.ai_quotas where user_id = p_user_id for update;
  if quota_record.suspended then return false; end if;

  daily_limit := case p_kind
    when 'chat' then quota_record.daily_chat
    when 'image' then quota_record.daily_image
    else quota_record.daily_video
  end;

  select count(*) into used_today
  from public.ai_usage
  where user_id = p_user_id
    and kind = p_kind
    and created_at >= date_trunc('day', now())
    and status in ('reserved', 'succeeded');

  if used_today >= daily_limit then return false; end if;

  insert into public.ai_usage (request_id, user_id, kind)
  values (p_request_id, p_user_id, p_kind)
  on conflict (request_id) do nothing;
  return found;
end;
$$;

revoke all on function public.reserve_ai_request(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(uuid, text, uuid) to service_role;

revoke all on function public.handle_new_messs_user() from public, anon, authenticated;
