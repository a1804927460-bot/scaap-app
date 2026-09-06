-- SQL standard strings preserve backslashes. Use [.] for a literal dot
-- so a valid stored MP4 path is not rejected as an invalid storage reference.
begin;
alter table public.ai_video_jobs
  drop constraint if exists ai_video_jobs_result_storage_ref_check;
alter table public.ai_video_jobs
  add constraint ai_video_jobs_result_storage_ref_check
  check (result_storage_ref is null or result_storage_ref ~*
    '^storage://messs-ai-video-results/[0-9a-f-]{36}/[0-9a-f-]{36}[.](mp4|webm|mov)$');

do $$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('record_ai_video_provider_storage', 'record_ai_video_provider_result')
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := replace(definition, chr(92) || chr(92) || '.(mp4|webm|mov)', '[.](mp4|webm|mov)');
    execute definition;
  end loop;
end;
$$;
notify pgrst, 'reload schema';
commit;
