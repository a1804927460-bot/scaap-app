-- Durable message recall for Messs direct chat.
-- This is a forward migration and must run after 202608040001_realtime_chat.sql.

begin;

alter table public.chat_messages
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists recalled_at timestamptz,
  add column if not exists recalled_by uuid references public.chat_profiles(id) on delete cascade;

-- The v2 content constraint required text/image payloads forever. Its
-- generated name can differ across partially applied development databases,
-- so identify only the multi-column content constraint by definition.
do $$
declare
  v_constraint name;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.chat_messages'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%kind%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%image_path%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%image_mime%'
  loop
    execute format('alter table public.chat_messages drop constraint %I', v_constraint);
  end loop;
end
$$;

-- A recalled row remains in the timeline but its private payload is
-- permanently redacted.
alter table public.chat_messages add constraint chat_messages_content_check check (
  (
    recalled_at is not null
    and recalled_by = sender_id
    and body is null
    and image_path is null
    and image_mime is null
    and image_width is null
    and image_height is null
  )
  or
  (
    recalled_at is null
    and recalled_by is null
    and (
      (kind = 'text' and body is not null and char_length(btrim(body)) > 0 and image_path is null)
      or
      (kind = 'image' and image_path is not null and image_mime like 'image/%')
    )
  )
);

create index if not exists chat_messages_updated_idx
  on public.chat_messages (updated_at, id);

create or replace function public.recall_chat_message(p_message_id uuid)
returns public.chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_message public.chat_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_message
  from public.chat_messages
  where id = p_message_id
  for update;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if v_message.sender_id is distinct from auth.uid() then
    raise exception 'Only the sender can recall this message' using errcode = '42501';
  end if;

  if v_message.recalled_at is null then
    update public.chat_messages
    set
      body = null,
      image_path = null,
      image_mime = null,
      image_width = null,
      image_height = null,
      recalled_at = now(),
      recalled_by = auth.uid(),
      updated_at = now()
    where id = v_message.id
    returning * into v_message;
  end if;

  return v_message;
end;
$$;

revoke all on function public.recall_chat_message(uuid) from public, anon, authenticated;
grant execute on function public.recall_chat_message(uuid) to authenticated;

-- Preserve the complete v2 capability audit and wrap it with the v3 recall
-- requirements. The guarded rename also makes local replays idempotent.
do $$
begin
  if to_regprocedure('public.chat_service_status_v2()') is null
    and to_regprocedure('public.chat_service_status()') is not null then
    alter function public.chat_service_status() rename to chat_service_status_v2;
  end if;
end
$$;

revoke all on function public.chat_service_status_v2() from public, anon, authenticated;

create or replace function public.chat_service_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
with
base as (
  select public.chat_service_status_v2() as status
),
recall_state as (
  select
    (
      select count(*) = 3
      from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('public.chat_messages')
        and a.attname in ('updated_at', 'recalled_at', 'recalled_by')
        and a.attnum > 0 and not a.attisdropped
    ) as columns_ready,
    exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = to_regclass('public.chat_messages')
        and c.conname = 'chat_messages_content_check'
        and c.contype = 'c' and c.convalidated
    ) as constraint_ready,
    case when to_regprocedure('public.recall_chat_message(uuid)') is null then false else
      coalesce(has_function_privilege(
        'authenticated', to_regprocedure('public.recall_chat_message(uuid)'), 'EXECUTE'
      ), false)
      and not coalesce(has_function_privilege(
        'anon', to_regprocedure('public.recall_chat_message(uuid)'), 'EXECUTE'
      ), false)
    end as rpc_ready
)
select base.status || jsonb_build_object(
  'schema_version', 3,
  'rpc_ready', coalesce((base.status ->> 'rpc_ready')::boolean, false)
    and recall_state.rpc_ready,
  'messages_ready', coalesce((base.status ->> 'messages_ready')::boolean, false)
    and recall_state.columns_ready and recall_state.constraint_ready,
  'recall_ready', recall_state.columns_ready and recall_state.constraint_ready
    and recall_state.rpc_ready
)
from base, recall_state
$$;

revoke all on function public.chat_service_status() from public, anon, authenticated;
grant execute on function public.chat_service_status() to authenticated;

commit;
