begin read only;
set local statement_timeout = '15s';
do $$
declare required_name text;
begin
  foreach required_name in array array[
    '202608280001','202608280002','202608280003','202608280004','202608280005','202608280006',
    '202609030001','202609040001','202609040002','202609050001',
    '202609050003','202609060001','202609060002','202609060003','202609070001'
  ] loop
    if not exists(select 1 from supabase_migrations.schema_migrations where version=required_name) then
      raise exception 'Missing required migration: %', required_name;
    end if;
  end loop;
  foreach required_name in array array['ai_image_jobs','ai_video_jobs','ai_usage'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=required_name and c.relrowsecurity) then
      raise exception 'Missing table or RLS: %', required_name;
    end if;
  end loop;
  foreach required_name in array array['claim_ai_image_job','record_ai_image_provider_task',
    'record_ai_image_provider_result','claim_due_ai_video_jobs','record_ai_video_provider_result',
    'record_ai_video_provider_storage','reserve_fal_tool_credits'] loop
    if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=required_name and has_function_privilege('service_role',p.oid,'EXECUTE')) then
      raise exception 'Missing service RPC: %', required_name;
    end if;
    if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=required_name
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then
      raise exception 'Unexpected public execution permission: %', required_name;
    end if;
  end loop;
  foreach required_name in array array['messs-ai-image-results','messs-ai-video-results'] loop
    if not exists(select 1 from storage.buckets where id=required_name and public=false) then
      raise exception 'Missing private result bucket: %', required_name;
    end if;
  end loop;
end;
$$;
select provider_id, resolution, public.quote_ai_image_unit_credits(provider_id,resolution) as credits
from (values
  ('image-1','1K'),('image-1','2K'),('image-1','4K'),
  ('image-2','1K'),('image-2','2K'),('image-2','4K'),
  ('image-6','low:1K'),('image-6','medium:1K'),('image-6','high:1K'),
  ('image-6','low:2K'),('image-6','medium:2K'),('image-6','high:2K'),
  ('image-6','low:4K'),('image-6','medium:4K'),('image-6','high:4K')
) as cases(provider_id,resolution);
rollback;
