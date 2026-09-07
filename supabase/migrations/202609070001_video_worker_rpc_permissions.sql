begin;

-- The worker RPC was dropped and recreated when its return columns changed.
-- PostgreSQL grants PUBLIC execution on new functions unless revoked again.
revoke all on function public.claim_due_ai_video_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_ai_video_jobs(text, integer, integer)
  to service_role;

notify pgrst, 'reload schema';
commit;
