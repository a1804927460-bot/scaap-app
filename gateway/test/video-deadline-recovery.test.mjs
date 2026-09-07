import test from 'node:test';
import assert from 'node:assert/strict';
import { runVideoJobWorkerCycle } from '../src/video-jobs.js';

const job = {
  request_id:'00000000-0000-4000-8000-000000000101',
  user_id:'00000000-0000-4000-8000-000000000102',
  lease_token:'00000000-0000-4000-8000-000000000103',
  provider_id:'video-1',provider_task_id:'accepted-task',status:'polling',attempt_count:12,
  created_at:'2026-09-06T09:37:17.000Z',deadline_at:'2026-09-06T09:57:17.000Z'
};
const video=Buffer.from('000000186674797069736f6d0000020069736f6d', 'hex');

test('worker persistence failures are observable without leaking task payloads',async()=>{
  const previous=process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY='sb_secret_test';
  try {
    const errors=[];
    const summary=await runVideoJobWorkerCycle({
      pollVideoTask:async()=>({status:'failed',errorCode:'provider-request-failed'}),
      onJobError:error=>errors.push(error),
      fetchImpl:async url=>String(url).endsWith('/claim_due_ai_video_jobs')
        ?Response.json([job]):Response.json({code:'22P02',message:'private database detail'},{status:400})
    });
    assert.equal(summary.errors,1);
    assert.deepEqual(errors,[{requestId:job.request_id,code:'video-job-service-failed',status:400}]);
  } finally {
    if(previous===undefined)delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY=previous;
  }
});

for(const scenario of ['completed','processing','poll-outage','storage-outage','terminal-failure','no-task']) {
  test(`expired video ${scenario} preserves accepted task semantics`, async()=>{
    const previous=process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY='sb_secret_test';
    const calls=[];let polled=0;
    try {
      const summary=await runVideoJobWorkerCycle({
        now:()=>Date.parse('2026-09-06T10:01:00Z'),
        pollVideoTask:async()=>{
          polled++;
          if(scenario==='poll-outage')throw Object.assign(new Error('connection interrupted'),{status:503});
          if(scenario==='processing')return {status:'running'};
          if(scenario==='terminal-failure')return {status:'failed',errorCode:'provider-failed'};
          return {status:'succeeded',resultUrl:'https://fal.media/video.mp4'};
        },
        fetchImpl:async(url,options={})=>{
          url=String(url);calls.push(url);
          if(url.endsWith('/claim_due_ai_video_jobs'))return Response.json([{...job,...(scenario==='no-task'?{provider_task_id:null}:{})}]);
          if(url.endsWith('/reschedule_ai_video_job'))return Response.json({ok:true,status:'polling'});
          if(url.endsWith('/finalize_ai_video_job'))return Response.json({ok:true,status:'failed'});
          if(url==='https://fal.media/video.mp4')return new Response(video,{headers:{'Content-Type':'video/mp4'}});
          if(url.includes('/storage/v1/object/')) {
            if(scenario==='storage-outage')return Response.json({},503);
            assert.deepEqual(options.body,video);
            return Response.json({Key:'saved.mp4'});
          }
          if(url.endsWith('/record_ai_video_provider_result'))return Response.json({ok:true,status:'ready'});
          throw new Error(`Unexpected request ${url}`);
        }
      });
      assert.equal(summary.errors,0);
      assert.equal(polled,scenario==='no-task'?0:1);
      if(scenario==='completed') {
        assert.equal(summary.succeeded,1);
        assert.ok(calls.findIndex(url=>url.includes('/storage/v1/object/'))<calls.findIndex(url=>url.endsWith('/record_ai_video_provider_result')));
      } else if(['terminal-failure','no-task'].includes(scenario))assert.equal(summary.failed,1);
      else assert.equal(summary.pending,1);
      assert.equal(calls.some(url=>url.endsWith('/finalize_ai_video_job')),['terminal-failure','no-task'].includes(scenario));
    } finally {
      if(previous===undefined)delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY=previous;
    }
  });
}
