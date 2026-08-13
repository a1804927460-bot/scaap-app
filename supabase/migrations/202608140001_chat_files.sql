begin;

alter table public.chat_messages
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_mime text,
  add column if not exists file_size bigint;

alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check
  check (kind in ('text', 'image', 'file'));

alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages add constraint chat_messages_content_check check (
  (recalled_at is not null and recalled_by = sender_id and body is null
    and image_path is null and image_mime is null and image_width is null and image_height is null
    and file_path is null and file_name is null and file_mime is null and file_size is null)
  or
  (recalled_at is null and recalled_by is null and (
    (kind = 'text' and body is not null and char_length(btrim(body)) > 0
      and image_path is null and file_path is null)
    or (kind = 'image' and image_path is not null and image_mime like 'image/%' and file_path is null)
    or (kind = 'file' and image_path is null and file_path is not null
      and file_name is not null and char_length(file_name) between 1 and 255
      and file_mime is not null and file_size between 1 and 104857600)
  ))
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists chat_files_select_members on storage.objects;
drop policy if exists chat_files_insert_owner on storage.objects;
drop policy if exists chat_files_delete_orphan_owner on storage.objects;

create policy chat_files_select_members on storage.objects for select to authenticated
using (
  bucket_id = 'chat-files'
  and case when name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(\.[a-z0-9]{1,16})?$'
    then public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid) else false end
);

create policy chat_files_insert_owner on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and case when name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(\.[a-z0-9]{1,16})?$'
    then (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_chat_conversation_member(((storage.foldername(name))[1])::uuid) else false end
);

create policy chat_files_delete_orphan_owner on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and not exists (select 1 from public.chat_messages m where m.file_path = storage.objects.name)
);

drop function if exists public.send_chat_message(uuid, uuid, text, text, text, text, integer, integer);
create function public.send_chat_message(
  p_conversation_id uuid, p_client_message_id uuid, p_kind text,
  p_body text default null, p_image_path text default null, p_image_mime text default null,
  p_image_width integer default null, p_image_height integer default null,
  p_file_path text default null, p_file_name text default null,
  p_file_mime text default null, p_file_size bigint default null
)
returns public.chat_messages language plpgsql security definer
set search_path = pg_catalog, public, storage, pg_temp as $$
declare v_message public.chat_messages%rowtype; v_extension text; v_expected_path text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_kind is null or p_kind not in ('text', 'image', 'file') then raise exception 'Invalid message kind'; end if;
  if not public.is_chat_conversation_member(p_conversation_id) then raise exception 'Conversation access denied'; end if;
  if p_kind = 'text' then
    if p_image_path is not null or p_file_path is not null then raise exception 'Invalid text metadata'; end if;
  elsif p_kind = 'image' then
    v_extension := case p_image_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png'
      when 'image/webp' then '.webp' when 'image/gif' then '.gif' when 'image/avif' then '.avif'
      when 'image/tiff' then '.tiff' when 'image/bmp' then '.bmp' else null end;
    v_expected_path := p_conversation_id::text || '/' || auth.uid()::text || '/' || p_client_message_id::text || v_extension;
    if v_extension is null or p_image_path is distinct from v_expected_path or p_file_path is not null
      then raise exception 'Invalid image metadata'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'chat-images' and name = p_image_path)
      then raise exception 'Image object not found'; end if;
  else
    v_extension := lower(substring(coalesce(p_file_name, '') from '(\.[A-Za-z0-9]{1,16})$'));
    if v_extension is null then v_extension := '.file'; end if;
    v_expected_path := p_conversation_id::text || '/' || auth.uid()::text || '/' || p_client_message_id::text || v_extension;
    if p_file_path is distinct from v_expected_path or p_image_path is not null
      or char_length(coalesce(p_file_name, '')) not between 1 and 255
      or p_file_size not between 1 and 104857600 then raise exception 'Invalid file metadata'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'chat-files' and name = p_file_path)
      then raise exception 'File object not found'; end if;
  end if;
  insert into public.chat_messages (client_message_id, conversation_id, sender_id, kind, body,
    image_path, image_mime, image_width, image_height, file_path, file_name, file_mime, file_size)
  values (p_client_message_id, p_conversation_id, auth.uid(), p_kind, p_body,
    p_image_path, p_image_mime, p_image_width, p_image_height, p_file_path, p_file_name, p_file_mime, p_file_size)
  on conflict (client_message_id) do nothing;
  select * into v_message from public.chat_messages where client_message_id = p_client_message_id;
  if v_message.sender_id is distinct from auth.uid()
    or v_message.conversation_id is distinct from p_conversation_id
    or v_message.kind is distinct from p_kind
    or coalesce(v_message.body, '') is distinct from coalesce(p_body, '')
    or coalesce(v_message.image_path, '') is distinct from coalesce(p_image_path, '')
    or coalesce(v_message.image_mime, '') is distinct from coalesce(p_image_mime, '')
    or v_message.image_width is distinct from p_image_width
    or v_message.image_height is distinct from p_image_height
    or coalesce(v_message.file_path, '') is distinct from coalesce(p_file_path, '')
    or coalesce(v_message.file_name, '') is distinct from coalesce(p_file_name, '')
    or coalesce(v_message.file_mime, '') is distinct from coalesce(p_file_mime, '')
    or v_message.file_size is distinct from p_file_size
    then raise exception 'Client message ID conflict'; end if;
  update public.chat_conversations set updated_at = greatest(updated_at, v_message.created_at) where id = v_message.conversation_id;
  return v_message;
end $$;

revoke all on function public.send_chat_message(uuid,uuid,text,text,text,text,integer,integer,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.send_chat_message(uuid,uuid,text,text,text,text,integer,integer,text,text,text,bigint) to authenticated;

create or replace function public.recall_chat_message(p_message_id uuid)
returns public.chat_messages language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_message public.chat_messages%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_message from public.chat_messages where id = p_message_id for update;
  if not found then raise exception 'Message not found'; end if;
  if v_message.sender_id is distinct from auth.uid() then raise exception 'Only the sender can recall this message'; end if;
  if v_message.recalled_at is null then
    update public.chat_messages set body = null, image_path = null, image_mime = null,
      image_width = null, image_height = null, file_path = null, file_name = null,
      file_mime = null, file_size = null, recalled_at = now(), recalled_by = auth.uid(), updated_at = now()
    where id = v_message.id returning * into v_message;
  end if;
  return v_message;
end $$;

create or replace function public.chat_service_status()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, storage, pg_temp as $$
select jsonb_build_object(
  'schema_version', 4, 'rpc_ready', true, 'messages_ready', true, 'recall_ready', true,
  'image_storage', exists(select 1 from storage.buckets where id = 'chat-images'),
  'file_storage', exists(select 1 from storage.buckets where id = 'chat-files'),
  'realtime', exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages')
) $$;

revoke all on function public.chat_service_status() from public, anon, authenticated;
grant execute on function public.chat_service_status() to authenticated;

commit;
