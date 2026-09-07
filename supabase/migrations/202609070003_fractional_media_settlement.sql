begin;

-- JSON numeric text is now e.g. "370.00". Direct text-to-integer casts
-- abort the whole video settlement, including its status and hold release.
-- Replace only credit-field casts; retain media pricing and all function ACLs.
do $$
declare
  entry record;
  definition text;
  updated text;
begin
  for entry in select oid, proname from pg_proc
    where pronamespace = 'public'::regnamespace and prokind = 'f'
      and proname in ('finalize_ai_video_job', 'settle_ai_video_download',
        'start_ai_video_job', 'get_canvas_ai_usage_summary')
  loop
    definition := pg_get_functiondef(entry.oid);
    updated := regexp_replace(definition,
      $pattern$(->>\s*'(credits|creditsCharged|creditsReleased|historicalCreditsCharged)'\s*\))::(integer|bigint)$pattern$,
      E'\\1::numeric', 'g');
    updated := regexp_replace(updated,
      $pattern$(->>\s*'(creditsCharged|historicalCreditsCharged)'\s*,\s*''\s*\))::bigint$pattern$,
      E'\\1::numeric', 'g');
    if entry.proname = 'finalize_ai_video_job' then
      -- A lease-checked terminal provider failure is not a speculative refund.
      -- Mark it inside the same transaction so the generic recovery guard
      -- permits release; any settlement error rolls both changes back.
      updated := replace(updated, '  settlement := public.settle_ai_credits(', $body$
  if normalized_status = 'failed' and job.status <> 'failed' then
    update public.ai_video_jobs set status = 'failed', completed_at = now()
      where request_id = p_request_id;
  end if;
  settlement := public.settle_ai_credits($body$);
    end if;
    if updated <> definition then execute updated; end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
