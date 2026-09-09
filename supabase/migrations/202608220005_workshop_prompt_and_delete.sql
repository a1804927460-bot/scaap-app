-- Preserve generation prompts for Workshop recreation and keep deletion owner-bound.

alter table if exists public.workshop_posts
  add column if not exists prompt text not null default '';

alter table if exists public.workshop_posts
  drop constraint if exists workshop_posts_prompt_length;

alter table if exists public.workshop_posts
  add constraint workshop_posts_prompt_length check (char_length(prompt) <= 12000);

drop policy if exists "Users can delete their Workshop posts" on public.workshop_posts;
create policy "Users can delete their Workshop posts"
  on public.workshop_posts for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Users can delete their Workshop media" on storage.objects;
create policy "Users can delete their Workshop media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'workshop-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
