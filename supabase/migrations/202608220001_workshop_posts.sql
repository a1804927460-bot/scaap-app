-- Creative Workshop: public media posts backed by the authenticated owner.
-- The desktop app keeps a local fallback, so this migration can be deployed
-- independently without making the Workshop page unusable during rollout.

insert into storage.buckets (id, name, public)
values ('workshop-media', 'workshop-media', true)
on conflict (id) do update set public = excluded.public;

create table if not exists public.workshop_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  prompt text not null default '' check (char_length(prompt) <= 12000),
  kind text not null check (kind in ('image', 'video')),
  media_path text not null unique,
  media_url text not null,
  mime_type text not null,
  source_file_name text not null,
  tags text[] not null default '{}',
  clicks integer not null default 0 check (clicks >= 0),
  likes integer not null default 0 check (likes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists workshop_posts_hot_idx
  on public.workshop_posts (clicks desc, created_at desc);
create index if not exists workshop_posts_owner_idx
  on public.workshop_posts (owner_id, created_at desc);

alter table public.workshop_posts enable row level security;
drop policy if exists "Workshop posts are publicly readable" on public.workshop_posts;
drop policy if exists "Users can publish their own Workshop posts" on public.workshop_posts;
drop policy if exists "Users can edit their own Workshop posts" on public.workshop_posts;
drop policy if exists "Users can delete their own Workshop posts" on public.workshop_posts;

create policy "Workshop posts are publicly readable"
  on public.workshop_posts for select
  using (true);
create policy "Users can publish their own Workshop posts"
  on public.workshop_posts for insert to authenticated
  with check (owner_id = auth.uid());
create policy "Users can edit their own Workshop posts"
  on public.workshop_posts for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy "Users can delete their own Workshop posts"
  on public.workshop_posts for delete to authenticated
  using (owner_id = auth.uid());

create table if not exists public.workshop_post_likes (
  post_id uuid not null references public.workshop_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.workshop_post_likes enable row level security;
drop policy if exists "Users can manage their Workshop likes" on public.workshop_post_likes;
create policy "Users can manage their Workshop likes"
  on public.workshop_post_likes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Workshop media is publicly readable" on storage.objects;
drop policy if exists "Users can upload their Workshop media" on storage.objects;
drop policy if exists "Users can delete their Workshop media" on storage.objects;
create policy "Workshop media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'workshop-media');
create policy "Users can upload their Workshop media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workshop-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "Users can delete their Workshop media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'workshop-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.workshop_increment_click(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.workshop_posts;
begin
  update public.workshop_posts
     set clicks = clicks + 1
   where id = p_post_id
   returning * into updated_row;
  if not found then
    raise exception using errcode = 'P0002', message = 'Workshop post not found';
  end if;
  return to_jsonb(updated_row);
end;
$$;

create or replace function public.workshop_toggle_like(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  removed boolean;
  liked_now boolean;
  total_likes integer;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not exists (select 1 from public.workshop_posts where id = p_post_id) then
    raise exception using errcode = 'P0002', message = 'Workshop post not found';
  end if;

  delete from public.workshop_post_likes
   where post_id = p_post_id and user_id = current_user_id;
  removed := found;
  if removed then
    liked_now := false;
  else
    insert into public.workshop_post_likes (post_id, user_id)
    values (p_post_id, current_user_id);
    liked_now := true;
  end if;

  select count(*)::integer into total_likes
    from public.workshop_post_likes where post_id = p_post_id;
  update public.workshop_posts set likes = total_likes where id = p_post_id;
  return jsonb_build_object('liked', liked_now, 'likes', total_likes);
end;
$$;

grant execute on function public.workshop_increment_click(uuid) to anon, authenticated;
grant execute on function public.workshop_toggle_like(uuid) to authenticated;

notify pgrst, 'reload schema';
