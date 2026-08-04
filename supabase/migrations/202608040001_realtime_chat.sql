-- Messs realtime direct chat, friendships, durable messages and private images.
-- Review, then run once in the Supabase SQL editor for the configured project.

create extension if not exists pgcrypto;

create table if not exists public.chat_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  messs_id text not null unique check (messs_id ~ '^MSS-[A-Z0-9]{8,16}$'),
  email text not null,
  display_name text not null default 'Messs user' check (char_length(display_name) between 1 and 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chat_profiles_email_lower_uidx on public.chat_profiles (lower(email));

create table if not exists public.chat_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.chat_profiles(id) on delete cascade,
  recipient_id uuid not null references public.chat_profiles(id) on delete cascade,
  pair_low uuid generated always as (least(sender_id, recipient_id)) stored,
  pair_high uuid generated always as (greatest(sender_id, recipient_id)) stored,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);

-- Compatibility for a partially applied development version of this same
-- migration that predated the generated unordered-pair columns.
alter table public.chat_friend_requests
  add column if not exists pair_low uuid generated always as (least(sender_id, recipient_id)) stored;
alter table public.chat_friend_requests
  add column if not exists pair_high uuid generated always as (greatest(sender_id, recipient_id)) stored;
drop index if exists public.chat_friend_requests_pending_pair_uidx;
create unique index chat_friend_requests_pending_pair_uidx
  on public.chat_friend_requests (pair_low, pair_high) where status = 'pending';
create index if not exists chat_friend_requests_recipient_idx
  on public.chat_friend_requests (recipient_id, created_at desc);
create index if not exists chat_friend_requests_sender_idx
  on public.chat_friend_requests (sender_id, created_at desc);

create table if not exists public.chat_friendships (
  user_low uuid not null references public.chat_profiles(id) on delete cascade,
  user_high uuid not null references public.chat_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high)
);
create index if not exists chat_friendships_user_high_idx
  on public.chat_friendships (user_high, user_low);

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind = 'direct'),
  direct_user_low uuid not null references public.chat_profiles(id) on delete cascade,
  direct_user_high uuid not null references public.chat_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (direct_user_low, direct_user_high),
  check (direct_user_low < direct_user_high)
);
create index if not exists chat_conversations_direct_user_high_idx
  on public.chat_conversations (direct_user_high, direct_user_low);

create table if not exists public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.chat_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists chat_conversation_members_user_idx
  on public.chat_conversation_members (user_id, conversation_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  client_message_id uuid not null,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.chat_profiles(id) on delete cascade,
  kind text not null check (kind in ('text', 'image')),
  body text,
  image_path text,
  image_mime text,
  image_width integer,
  image_height integer,
  created_at timestamptz not null default now(),
  check (body is null or char_length(body) <= 8000),
  check (
    (kind = 'text' and body is not null and char_length(btrim(body)) > 0 and image_path is null)
    or
    (kind = 'image' and image_path is not null and image_mime like 'image/%')
  ),
  check (image_width is null or image_width > 0),
  check (image_height is null or image_height > 0)
);
do $$
begin
  if exists (
    select 1 from public.chat_messages
    group by client_message_id having count(*) > 1
  ) then
    raise exception 'Duplicate chat client message IDs must be resolved before schema v2';
  end if;
end $$;
alter table public.chat_messages
  drop constraint if exists chat_messages_sender_id_client_message_id_key;
create unique index if not exists chat_messages_client_message_id_uidx
  on public.chat_messages (client_message_id);
create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at desc, id desc);
create index if not exists chat_messages_sender_idx
  on public.chat_messages (sender_id);

create or replace function public.make_messs_id(p_id uuid)
returns text language sql immutable strict
as $$ select 'MSS-' || upper(substr(replace(p_id::text, '-', ''), 1, 16)) $$;

create or replace function public.sync_chat_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.chat_profiles (id, messs_id, email, display_name)
  values (
    new.id,
    public.make_messs_id(new.id),
    lower(coalesce(new.email, new.id::text || '@invalid.local')),
    left(coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(split_part(new.email, '@', 1), ''), 'Messs user'), 80)
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = case
      when public.chat_profiles.display_name = 'Messs user' then excluded.display_name
      else public.chat_profiles.display_name
    end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_chat_profile on auth.users;
create trigger on_auth_user_chat_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_chat_profile_from_auth();

-- Backfill accounts created before this migration.
insert into public.chat_profiles (id, messs_id, email, display_name)
select
  u.id,
  public.make_messs_id(u.id),
  lower(coalesce(u.email, u.id::text || '@invalid.local')),
  left(coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(split_part(u.email, '@', 1), ''), 'Messs user'), 80)
from auth.users u
on conflict (id) do nothing;

alter table public.chat_profiles enable row level security;
alter table public.chat_friend_requests enable row level security;
alter table public.chat_friendships enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'chat_profiles','chat_friend_requests','chat_friendships',
    'chat_conversations','chat_conversation_members','chat_messages'
  ] loop
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Clients mutate chat data only through the validated RPC functions below.
-- RLS remains the second boundary, but ordinary table grants are select-only.
revoke all on public.chat_profiles, public.chat_friend_requests, public.chat_friendships,
  public.chat_conversations, public.chat_conversation_members, public.chat_messages
  from anon, authenticated;

drop policy if exists chat_profiles_select_visible on public.chat_profiles;
create policy chat_profiles_select_visible on public.chat_profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.chat_friendships f
    where (f.user_low = (select auth.uid()) and f.user_high = chat_profiles.id)
       or (f.user_high = (select auth.uid()) and f.user_low = chat_profiles.id)
  )
);

drop policy if exists chat_friend_requests_select_involved on public.chat_friend_requests;
create policy chat_friend_requests_select_involved on public.chat_friend_requests for select to authenticated
using ((select auth.uid()) in (sender_id, recipient_id));

drop policy if exists chat_friendships_select_involved on public.chat_friendships;
create policy chat_friendships_select_involved on public.chat_friendships for select to authenticated
using ((select auth.uid()) in (user_low, user_high));

drop policy if exists chat_conversations_select_member on public.chat_conversations;
create policy chat_conversations_select_member on public.chat_conversations for select to authenticated
using (exists (
  select 1 from public.chat_conversation_members m
  where m.conversation_id = chat_conversations.id and m.user_id = (select auth.uid())
));

drop policy if exists chat_members_select_member on public.chat_conversation_members;
create policy chat_members_select_member on public.chat_conversation_members for select to authenticated
using (user_id = (select auth.uid()));

-- Remove the development helper and any policies that depended on its
-- caller-controlled user id. The replacement is bound to auth.uid(), so it
-- cannot be used as a conversation-membership oracle for arbitrary users.
drop policy if exists chat_images_select_members on storage.objects;
drop policy if exists chat_images_insert_owner on storage.objects;
drop policy if exists chat_images_update_owner on storage.objects;
drop policy if exists chat_images_delete_orphan_owner on storage.objects;
drop function if exists public.is_chat_conversation_member(uuid, uuid);

create or replace function public.is_chat_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid()
  )
$$;
revoke all on function public.is_chat_conversation_member(uuid) from public, anon, authenticated;
grant execute on function public.is_chat_conversation_member(uuid) to authenticated;

drop policy if exists chat_messages_select_member on public.chat_messages;
create policy chat_messages_select_member on public.chat_messages for select to authenticated
using (exists (
  select 1 from public.chat_conversation_members m
  where m.conversation_id = chat_messages.conversation_id and m.user_id = (select auth.uid())
));

-- Exact-match search runs as a narrowly scoped definer function. No endpoint
-- can enumerate profiles or perform fuzzy/prefix email searches.
create or replace function public.search_chat_profile(p_query text)
returns table (
  id uuid, messs_id text, display_name text, email text, avatar_url text, relationship_status text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.messs_id, p.display_name,
    case when lower(p.email) = lower(btrim(p_query)) then p.email else '' end,
    p.avatar_url,
    case
      when exists (select 1 from public.chat_friendships f where (f.user_low, f.user_high) = (least(auth.uid(), p.id), greatest(auth.uid(), p.id))) then 'friend'
      when exists (select 1 from public.chat_friend_requests r where r.sender_id = auth.uid() and r.recipient_id = p.id and r.status = 'pending') then 'outgoing'
      when exists (select 1 from public.chat_friend_requests r where r.sender_id = p.id and r.recipient_id = auth.uid() and r.status = 'pending') then 'incoming'
      else 'none'
    end
  from public.chat_profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and (lower(p.email) = lower(btrim(p_query)) or upper(p.messs_id) = upper(btrim(p_query)))
  limit 1
$$;

create or replace function public.send_chat_friend_request(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_target_id = auth.uid() then raise exception 'You cannot add yourself'; end if;
  if not exists (select 1 from public.chat_profiles where id = p_target_id) then raise exception 'User not found'; end if;
  -- Serialize both A→B and B→A on the same transaction lock, then enforce the
  -- unordered partial unique index. Concurrent cross-requests cannot coexist.
  perform pg_advisory_xact_lock(hashtextextended(
    least(auth.uid(), p_target_id)::text || ':' || greatest(auth.uid(), p_target_id)::text, 0
  ));
  if exists (select 1 from public.chat_friendships where (user_low, user_high) = (least(auth.uid(), p_target_id), greatest(auth.uid(), p_target_id))) then
    raise exception 'Already friends';
  end if;
  if exists (select 1 from public.chat_friend_requests where sender_id = p_target_id and recipient_id = auth.uid() and status = 'pending') then
    raise exception 'This user already sent you a friend request';
  end if;
  select id into v_id from public.chat_friend_requests
    where sender_id = auth.uid() and recipient_id = p_target_id and status = 'pending' limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.chat_friend_requests (sender_id, recipient_id)
  values (auth.uid(), p_target_id) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.respond_chat_friend_request(p_request_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_request public.chat_friend_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_action not in ('accept', 'reject') then raise exception 'Invalid action'; end if;
  select * into v_request from public.chat_friend_requests
    where id = p_request_id and recipient_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'Pending request not found'; end if;
  update public.chat_friend_requests set
    status = case when p_action = 'accept' then 'accepted' else 'rejected' end,
    responded_at = now()
  where id = p_request_id;
  if p_action = 'accept' then
    insert into public.chat_friendships (user_low, user_high)
    values (least(v_request.sender_id, v_request.recipient_id), greatest(v_request.sender_id, v_request.recipient_id))
    on conflict do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.create_chat_direct_conversation(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.chat_friendships
    where (user_low, user_high) = (least(auth.uid(), p_friend_id), greatest(auth.uid(), p_friend_id))
  ) then raise exception 'Only friends can start a conversation'; end if;
  insert into public.chat_conversations (direct_user_low, direct_user_high)
  values (least(auth.uid(), p_friend_id), greatest(auth.uid(), p_friend_id))
  on conflict (direct_user_low, direct_user_high) do update set updated_at = excluded.updated_at
  returning id into v_id;
  insert into public.chat_conversation_members (conversation_id, user_id)
  values (v_id, auth.uid()), (v_id, p_friend_id) on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_kind text,
  p_body text default null,
  p_image_path text default null,
  p_image_mime text default null,
  p_image_width integer default null,
  p_image_height integer default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  v_message public.chat_messages%rowtype;
  v_extension text;
  v_expected_path text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_kind is null or p_kind not in ('text', 'image') then raise exception 'Invalid message kind'; end if;
  if not exists (select 1 from public.chat_conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'Conversation access denied';
  end if;
  if p_kind = 'text' then
    if p_image_path is not null or p_image_mime is not null
      or p_image_width is not null or p_image_height is not null then
      raise exception 'Text messages cannot contain image metadata';
    end if;
  else
    v_extension := case p_image_mime
      when 'image/jpeg' then '.jpg'
      when 'image/png' then '.png'
      when 'image/webp' then '.webp'
      when 'image/gif' then '.gif'
      when 'image/avif' then '.avif'
      when 'image/tiff' then '.tiff'
      when 'image/bmp' then '.bmp'
      else null
    end;
    v_expected_path := p_conversation_id::text || '/' || auth.uid()::text || '/'
      || p_client_message_id::text || v_extension;
    if coalesce(p_body, '') <> '' or v_extension is null
      or p_image_path is distinct from v_expected_path then
      raise exception 'Invalid image object path or MIME type';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'chat-images' and o.name = p_image_path
    ) then raise exception 'Image object not found'; end if;
  end if;
  insert into public.chat_messages (
    client_message_id, conversation_id, sender_id, kind, body,
    image_path, image_mime, image_width, image_height
  ) values (
    p_client_message_id, p_conversation_id, auth.uid(), p_kind, p_body,
    p_image_path, p_image_mime, p_image_width, p_image_height
  ) on conflict (client_message_id) do nothing;
  select * into v_message from public.chat_messages
    where client_message_id = p_client_message_id;
  if not found then raise exception 'Message insert failed'; end if;
  if v_message.sender_id is distinct from auth.uid() then
    raise exception 'Client message ID belongs to another sender';
  end if;
  if v_message.conversation_id is distinct from p_conversation_id
    or v_message.kind is distinct from p_kind
    or coalesce(v_message.body, '') is distinct from coalesce(p_body, '')
    or coalesce(v_message.image_path, '') is distinct from coalesce(p_image_path, '')
    or coalesce(v_message.image_mime, '') is distinct from coalesce(p_image_mime, '')
    or v_message.image_width is distinct from p_image_width
    or v_message.image_height is distinct from p_image_height then
    raise exception 'Client message ID was already used with different content';
  end if;
  update public.chat_conversations set updated_at = greatest(updated_at, v_message.created_at)
    where id = v_message.conversation_id;
  return v_message;
end;
$$;

create or replace function public.chat_bootstrap()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.chat_profiles p where p.id = auth.uid()),
    'friends', coalesce((
      select jsonb_agg(to_jsonb(p) order by lower(p.display_name))
      from public.chat_friendships f
      join public.chat_profiles p on p.id = case when f.user_low = auth.uid() then f.user_high else f.user_low end
      where auth.uid() in (f.user_low, f.user_high)
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'direction', case when r.sender_id = auth.uid() then 'outgoing' else 'incoming' end,
        'status', r.status,
        'created_at', r.created_at,
        'profile', to_jsonb(p) || jsonb_build_object(
          'email', case when exists (
            select 1 from public.chat_friendships f
            where (f.user_low, f.user_high) = (least(auth.uid(), p.id), greatest(auth.uid(), p.id))
          ) then p.email else '' end
        )
      ) order by r.created_at desc)
      from public.chat_friend_requests r
      join public.chat_profiles p on p.id = case when r.sender_id = auth.uid() then r.recipient_id else r.sender_id end
      where auth.uid() in (r.sender_id, r.recipient_id) and r.status = 'pending'
    ), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'other', to_jsonb(p)
      ) order by c.updated_at desc)
      from public.chat_conversation_members mine
      join public.chat_conversations c on c.id = mine.conversation_id
      join public.chat_conversation_members other on other.conversation_id = c.id and other.user_id <> auth.uid()
      join public.chat_profiles p on p.id = other.user_id
      where mine.user_id = auth.uid()
    ), '[]'::jsonb)
  )
$$;

-- One authenticated, read-only capability probe lets the desktop distinguish
-- a missing/partial migration from an offline connection. Keep this contract
-- versioned whenever the required chat schema changes.
create or replace function public.chat_service_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
with
required_tables(relname) as (values
  ('chat_profiles'), ('chat_friend_requests'), ('chat_friendships'),
  ('chat_conversations'), ('chat_conversation_members'), ('chat_messages')
),
required_rpcs(sig) as (values
  ('public.chat_service_status()'), ('public.chat_bootstrap()'),
  ('public.search_chat_profile(text)'),
  ('public.send_chat_friend_request(uuid)'),
  ('public.respond_chat_friend_request(uuid,text)'),
  ('public.create_chat_direct_conversation(uuid)'),
  ('public.send_chat_message(uuid,uuid,text,text,text,text,integer,integer)')
),
required_public_policies(relname, policyname) as (values
  ('chat_profiles', 'chat_profiles_select_visible'),
  ('chat_friend_requests', 'chat_friend_requests_select_involved'),
  ('chat_friendships', 'chat_friendships_select_involved'),
  ('chat_conversations', 'chat_conversations_select_member'),
  ('chat_conversation_members', 'chat_members_select_member'),
  ('chat_messages', 'chat_messages_select_member')
),
required_storage_policies(policyname, cmd) as (values
  ('chat_images_select_members', 'SELECT'),
  ('chat_images_insert_owner', 'INSERT'),
  ('chat_images_delete_orphan_owner', 'DELETE')
),
required_realtime(relname) as (values
  ('chat_messages'), ('chat_friend_requests'),
  ('chat_friendships'), ('chat_conversation_members')
),
table_state as (
  select required.relname, c.oid, c.relrowsecurity, c.relforcerowsecurity
  from required_tables required
  left join pg_catalog.pg_class c
    on c.relnamespace = 'public'::regnamespace
    and c.relname = required.relname and c.relkind in ('r', 'p')
),
table_check as (
  select
    count(oid) = (select count(*) from required_tables) as present,
    coalesce(bool_and(coalesce(relrowsecurity, false) and coalesce(relforcerowsecurity, false)), false) as rls,
    coalesce(bool_and(
      oid is not null
      and coalesce(has_table_privilege('authenticated', oid, 'SELECT'), false)
      and not coalesce(has_table_privilege('authenticated', oid, 'INSERT'), false)
      and not coalesce(has_table_privilege('authenticated', oid, 'UPDATE'), false)
      and not coalesce(has_table_privilege('authenticated', oid, 'DELETE'), false)
      and not coalesce(has_table_privilege('anon', oid, 'SELECT'), false)
      and not coalesce(has_table_privilege('anon', oid, 'INSERT'), false)
      and not coalesce(has_table_privilege('anon', oid, 'UPDATE'), false)
      and not coalesce(has_table_privilege('anon', oid, 'DELETE'), false)
    ), false) as grants
  from table_state
),
rpc_check as (
  select coalesce(bool_and(
    case when to_regprocedure(sig) is null then false else
      coalesce(has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE'), false)
      and not coalesce(has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE'), false)
    end
  ), false) as ok
  from required_rpcs
),
helper_check as (
  select
    case when to_regprocedure('public.is_chat_conversation_member(uuid)') is null then false else
      to_regprocedure('public.is_chat_conversation_member(uuid,uuid)') is null
      and coalesce(has_function_privilege(
        'authenticated', to_regprocedure('public.is_chat_conversation_member(uuid)'), 'EXECUTE'
      ), false)
      and not coalesce(has_function_privilege(
        'anon', to_regprocedure('public.is_chat_conversation_member(uuid)'), 'EXECUTE'
      ), false)
    end as ok
),
global_id_check as (
  select exists (
    select 1 from pg_catalog.pg_index i
    where i.indrelid = to_regclass('public.chat_messages')
      and i.indisunique and i.indisvalid and i.indisready
      and i.indpred is null and i.indexprs is null and i.indnkeyatts = 1
      and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'client_message_id'
  ) as ok
),
public_policy_check as (
  select not exists (
    select 1 from required_public_policies expected
    left join pg_catalog.pg_policies p
      on p.schemaname = 'public' and p.tablename = expected.relname
      and p.policyname = expected.policyname
    where p.policyname is null or p.permissive <> 'PERMISSIVE' or p.cmd <> 'SELECT'
      or not ('authenticated'::name = any (p.roles)) or p.qual is null
  ) and not exists (
    select 1 from pg_catalog.pg_policies p
    join required_tables required on required.relname = p.tablename
    where p.schemaname = 'public'
      and not exists (
        select 1 from required_public_policies expected
        where expected.relname = p.tablename and expected.policyname = p.policyname
      )
  ) as ok
),
bucket_check as (
  select coalesce(bool_and(
    b.public = false and b.file_size_limit = 52428800
    and b.allowed_mime_types @> array[
      'image/jpeg','image/png','image/webp','image/gif',
      'image/avif','image/tiff','image/bmp'
    ]::text[]
    and b.allowed_mime_types <@ array[
      'image/jpeg','image/png','image/webp','image/gif',
      'image/avif','image/tiff','image/bmp'
    ]::text[]
  ), false) as ok
  from storage.buckets b where b.id = 'chat-images'
),
storage_policy_check as (
  select not exists (
    select 1 from required_storage_policies expected
    left join pg_catalog.pg_policies p
      on p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname = expected.policyname
    where p.policyname is null or p.permissive <> 'PERMISSIVE' or p.cmd <> expected.cmd
      or not ('authenticated'::name = any (p.roles))
      or (expected.cmd = 'INSERT' and p.with_check is null)
      or (expected.cmd in ('SELECT', 'DELETE') and p.qual is null)
  ) and not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname like 'chat_images_%'
      and not exists (
        select 1 from required_storage_policies expected where expected.policyname = p.policyname
      )
  ) as ok
),
realtime_check as (
  select not exists (
    select 1 from required_realtime required
    where not exists (
      select 1 from pg_catalog.pg_publication_tables p
      where p.pubname = 'supabase_realtime' and p.schemaname = 'public'
        and p.tablename = required.relname
    )
  ) as ok
)
select jsonb_build_object(
  'schema_version', 2,
  'rpc_ready', rpc_check.ok,
  'messages_ready', table_check.present and table_check.rls and table_check.grants
    and public_policy_check.ok and global_id_check.ok,
  'image_storage', bucket_check.ok and storage_policy_check.ok and helper_check.ok,
  'realtime', realtime_check.ok,
  'rls_ready', table_check.present and table_check.rls,
  'grants_ready', table_check.present and table_check.grants and rpc_check.ok and helper_check.ok,
  'policies_ready', public_policy_check.ok and storage_policy_check.ok,
  'client_message_ids_global', global_id_check.ok
)
from table_check, rpc_check, helper_check, global_id_check,
  public_policy_check, bucket_check, storage_policy_check, realtime_check
$$;

revoke all on function public.search_chat_profile(text) from public, anon;
revoke all on function public.send_chat_friend_request(uuid) from public, anon;
revoke all on function public.respond_chat_friend_request(uuid, text) from public, anon;
revoke all on function public.create_chat_direct_conversation(uuid) from public, anon;
revoke all on function public.send_chat_message(uuid, uuid, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.chat_bootstrap() from public, anon;
revoke all on function public.chat_service_status() from public, anon;
grant execute on function public.search_chat_profile(text) to authenticated;
grant execute on function public.send_chat_friend_request(uuid) to authenticated;
grant execute on function public.respond_chat_friend_request(uuid, text) to authenticated;
grant execute on function public.create_chat_direct_conversation(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, uuid, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.chat_bootstrap() to authenticated;
grant execute on function public.chat_service_status() to authenticated;

grant select on public.chat_profiles, public.chat_friend_requests, public.chat_friendships,
  public.chat_conversations, public.chat_conversation_members, public.chat_messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images', 'chat-images', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/tiff','image/bmp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_images_select_members on storage.objects;
drop policy if exists chat_images_insert_owner on storage.objects;
drop policy if exists chat_images_update_owner on storage.objects;
drop policy if exists chat_images_delete_orphan_owner on storage.objects;

create policy chat_images_select_members on storage.objects for select to authenticated
using (
  bucket_id = 'chat-images'
  and case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif|tiff|bmp)$'
    then public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);

create policy chat_images_insert_owner on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-images'
  and case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif|tiff|bmp)$'
    then (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);

create policy chat_images_delete_orphan_owner on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-images'
  and case when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif|tiff|bmp)$'
    then (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid)
      and not exists (
        select 1 from public.chat_messages m where m.image_path = storage.objects.name
      )
    else false
  end
);

-- Idempotently add only the tables needed for realtime notifications.
do $$
declare t text;
begin
  foreach t in array array['chat_messages','chat_friend_requests','chat_friendships','chat_conversation_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
