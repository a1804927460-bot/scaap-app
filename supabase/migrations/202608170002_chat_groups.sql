begin;

alter table public.chat_conversations
  add column if not exists name text,
  add column if not exists owner_id uuid references public.chat_profiles(id) on delete restrict;

alter table public.chat_conversations alter column direct_user_low drop not null;
alter table public.chat_conversations alter column direct_user_high drop not null;
alter table public.chat_conversations drop constraint if exists chat_conversations_kind_check;
alter table public.chat_conversations drop constraint if exists chat_conversations_check;
alter table public.chat_conversations add constraint chat_conversations_kind_check
  check (kind in ('direct', 'group'));
alter table public.chat_conversations add constraint chat_conversations_shape_check check (
  (kind = 'direct' and direct_user_low is not null and direct_user_high is not null
    and direct_user_low < direct_user_high and name is null and owner_id is null)
  or
  (kind = 'group' and direct_user_low is null and direct_user_high is null
    and owner_id is not null and char_length(btrim(name)) between 1 and 80)
);

drop policy if exists chat_members_select_member on public.chat_conversation_members;
create policy chat_members_select_member on public.chat_conversation_members for select to authenticated
using (public.is_chat_conversation_member(conversation_id));

create or replace function public.create_chat_group(p_name text, p_member_ids uuid[])
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_id uuid; v_member_id uuid; v_members uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Invalid group name'; end if;
  select coalesce(array_agg(distinct value), '{}'::uuid[]) into v_members
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as value
  where value <> auth.uid();
  if cardinality(v_members) not between 1 and 99 then raise exception 'Select between 1 and 99 friends'; end if;
  foreach v_member_id in array v_members loop
    if not exists (
      select 1 from public.chat_friendships
      where (user_low, user_high) = (least(auth.uid(), v_member_id), greatest(auth.uid(), v_member_id))
    ) then raise exception 'Only friends can be invited'; end if;
  end loop;
  insert into public.chat_conversations(kind, name, owner_id)
  values ('group', btrim(p_name), auth.uid()) returning id into v_id;
  insert into public.chat_conversation_members(conversation_id, user_id) values (v_id, auth.uid());
  insert into public.chat_conversation_members(conversation_id, user_id)
    select v_id, value from unnest(v_members) as value on conflict do nothing;
  return v_id;
end $$;

create or replace function public.add_chat_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns integer language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_member_id uuid; v_members uuid[]; v_added integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.chat_conversations
    where id = p_conversation_id and kind = 'group' and owner_id = auth.uid()
  ) then raise exception 'Only the group owner can add members'; end if;
  select coalesce(array_agg(distinct value), '{}'::uuid[]) into v_members
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as value
  where value <> auth.uid();
  if cardinality(v_members) not between 1 and 99 then raise exception 'Select at least one friend'; end if;
  foreach v_member_id in array v_members loop
    if not exists (
      select 1 from public.chat_friendships
      where (user_low, user_high) = (least(auth.uid(), v_member_id), greatest(auth.uid(), v_member_id))
    ) then raise exception 'Only friends can be invited'; end if;
  end loop;
  insert into public.chat_conversation_members(conversation_id, user_id)
    select p_conversation_id, value from unnest(v_members) as value
    on conflict do nothing;
  get diagnostics v_added = row_count;
  update public.chat_conversations set updated_at = now() where id = p_conversation_id;
  return v_added;
end $$;

create or replace function public.chat_bootstrap()
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
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
      'id', r.id, 'direction', case when r.sender_id = auth.uid() then 'outgoing' else 'incoming' end,
      'status', r.status, 'created_at', r.created_at, 'profile', to_jsonb(p) || jsonb_build_object(
        'email', case when exists (select 1 from public.chat_friendships f
          where (f.user_low, f.user_high) = (least(auth.uid(), p.id), greatest(auth.uid(), p.id)))
        then p.email else '' end
      )) order by r.created_at desc)
    from public.chat_friend_requests r
    join public.chat_profiles p on p.id = case when r.sender_id = auth.uid() then r.recipient_id else r.sender_id end
    where auth.uid() in (r.sender_id, r.recipient_id) and r.status = 'pending'
  ), '[]'::jsonb),
  'conversations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'type', c.kind, 'name', c.name, 'owner_id', c.owner_id,
      'created_at', c.created_at, 'updated_at', c.updated_at,
      'other', case when c.kind = 'direct' then (
        select to_jsonb(p) from public.chat_conversation_members cm
        join public.chat_profiles p on p.id = cm.user_id
        where cm.conversation_id = c.id and cm.user_id <> auth.uid() limit 1
      ) else null end,
      'members', case when c.kind = 'group' then (
        select coalesce(jsonb_agg(to_jsonb(p) order by lower(p.display_name)), '[]'::jsonb)
        from public.chat_conversation_members cm join public.chat_profiles p on p.id = cm.user_id
        where cm.conversation_id = c.id
      ) else '[]'::jsonb end,
      'member_count', (select count(*) from public.chat_conversation_members cm where cm.conversation_id = c.id)
    ) order by c.updated_at desc)
    from public.chat_conversation_members mine
    join public.chat_conversations c on c.id = mine.conversation_id
    where mine.user_id = auth.uid()
  ), '[]'::jsonb)
) $$;

create or replace function public.chat_service_status()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, storage, pg_temp as $$
select jsonb_build_object(
  'schema_version', 5, 'rpc_ready', true, 'messages_ready', true, 'recall_ready', true,
  'group_ready', true,
  'image_storage', exists(select 1 from storage.buckets where id = 'chat-images'),
  'file_storage', exists(select 1 from storage.buckets where id = 'chat-files'),
  'realtime', exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages')
) $$;

revoke all on function public.create_chat_group(text,uuid[]) from public, anon, authenticated;
revoke all on function public.add_chat_group_members(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.create_chat_group(text,uuid[]) to authenticated;
grant execute on function public.add_chat_group_members(uuid,uuid[]) to authenticated;
revoke all on function public.chat_bootstrap() from public, anon, authenticated;
grant execute on function public.chat_bootstrap() to authenticated;
revoke all on function public.chat_service_status() from public, anon, authenticated;
grant execute on function public.chat_service_status() to authenticated;

commit;
