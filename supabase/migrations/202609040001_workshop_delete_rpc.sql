-- Delete a Workshop post only when the authenticated user owns it.

create or replace function public.workshop_delete_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_row public.workshop_posts;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  delete from public.workshop_posts
   where id = p_post_id and owner_id = current_user_id
   returning * into deleted_row;

  if not found then
    if exists (select 1 from public.workshop_posts where id = p_post_id) then
      raise exception using errcode = '42501', message = 'Only the creator can delete this Workshop work';
    end if;
    raise exception using errcode = 'P0002', message = 'Workshop post not found';
  end if;

  return to_jsonb(deleted_row);
end;
$$;

revoke all on function public.workshop_delete_post(uuid) from public;
grant execute on function public.workshop_delete_post(uuid) to authenticated;

notify pgrst, 'reload schema';
