do $$
declare
  uid uuid := gen_random_uuid();
  req uuid;
  token text;
  result jsonb;
  price integer;
  balance_before numeric := 10000.86;
begin
  insert into auth.users(id) values(uid);
  update public.ai_credit_accounts set balance=balance_before where user_id=uid;
  for scenario in 1..2 loop
    req := gen_random_uuid();
    token := replace(req::text,'-','') || repeat('a',32);
    price := public.quote_ai_video_retail_credits('video-3','720P',5,0,false);
    result := public.start_ai_video_job(req,uid,token,repeat('b',64),'video-3','720P',5,'16:9',price);
    assert (result->>'ok')::boolean, 'video reserve';
    if scenario=1 then
      -- Rejection must release immediately, not after the 20-minute deadline.
      result := public.finalize_ai_video_job(req,null,'failed',p_error_code=>'provider-request-failed');
      assert (result->>'ok')::boolean and result->>'status'='failed', 'terminal failure';
      assert (result->>'creditsReleased')::numeric=price, 'release decimal JSON';
      result := public.finalize_ai_video_job(req,null,'failed');
      assert result->>'reason'='already-finalized', 'failure idempotent';
      assert (select balance=balance_before and reserved=0 from public.ai_credit_accounts where user_id=uid), 'failure balance';
    else
      update public.ai_video_jobs set status='ready',result_url='https://example.com/result.mp4'
        where request_id=req;
      result := public.settle_ai_video_download(uid,token,'video/mp4',100);
      assert (result->>'ok')::boolean and result->>'status'='succeeded', 'successful delivery';
      assert (result->>'creditsCharged')::numeric=price, 'media price unchanged';
      result := public.settle_ai_video_download(uid,token,'video/mp4',100);
      assert result->>'reason'='already-settled', 'delivery idempotent';
      assert (select balance=balance_before-price and reserved=0 from public.ai_credit_accounts where user_id=uid), 'fractional balance retained';
    end if;
  end loop;
  assert not has_function_privilege('authenticated','public.finalize_ai_video_job(uuid,uuid,text,text,text,bigint,text,text,integer)','execute'), 'service-only finalization';
end;
$$;
select 'video terminal failure, delivery, idempotency and fractional balances passed; rolled back' as result;
