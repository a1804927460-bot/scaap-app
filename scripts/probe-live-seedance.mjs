import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import sharp from 'sharp';

if(process.env.MESSS_LIVE_VIDEO_AUDIT!=='1') throw new Error('Explicit paid video audit opt-in required.');
const project=process.env.SUPABASE_URL, secret=process.env.SUPABASE_SECRET_KEY;
const gateway=process.env.MESSS_AI_GATEWAY_URL, publicKey=process.env.SUPABASE_PUBLISHABLE_KEY;
assert.ok(project&&secret&&gateway&&publicKey);
const admin={apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
const email=`messs-video-audit-${randomUUID()}@example.com`, password=randomBytes(32).toString('hex');
let userId, authorization, taskToken;
let terminal=false;
async function json(url,options={}) {
  const response=await fetch(url,{signal:AbortSignal.timeout(180000),...options});
  const body=await response.json();
  if(!response.ok) throw new Error(`HTTP ${response.status}: ${body.code||'request failed'}`);
  return body;
}
async function post(route,body) {
  return json(gateway+route,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)});
}
try {
  const user=await json(project+'/auth/v1/admin/users',{method:'POST',headers:admin,
    body:JSON.stringify({email,password,email_confirm:true,user_metadata:{purpose:'seedance-video-audit'}})});
  userId=user.id;
  const session=await json(project+'/auth/v1/token?grant_type=password',{method:'POST',
    headers:{apikey:publicKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  authorization=`Bearer ${session.access_token}`;
  const funded=await fetch(`${project}/rest/v1/ai_credit_accounts?user_id=eq.${userId}`,{
    method:'PATCH',headers:admin,body:JSON.stringify({balance:2000.86}),signal:AbortSignal.timeout(30000)});
  assert.ok(funded.ok);
  const grant=await fetch(project+'/rest/v1/ai_credit_ledger',{method:'POST',headers:admin,
    body:JSON.stringify({user_id:userId,event_type:'grant',balance_delta:2000.86,reserved_delta:0,
      balance_after:2000.86,reserved_after:0,idempotency_key:`audit:${userId}`}),signal:AbortSignal.timeout(30000)});
  assert.ok(grant.ok);
  const image=await sharp({create:{width:512,height:512,channels:3,background:'#457b9d'}})
    .composite([{input:await sharp({create:{width:180,height:180,channels:3,background:'#e63946'}}).png().toBuffer(),left:166,top:166}]).png().toBuffer();
  const operationId=randomUUID(); taskToken='d_'+randomBytes(32).toString('hex');
  const body={operationId,taskToken,providerId:'video-3',prompt:'Create a new video. The red square rotates slowly on the blue background. Fixed camera.',
    videoMode:'omni',urls:['data:image/png;base64,'+image.toString('base64')],referenceMediaTypes:['image'],
    duration:4,resolution:'480P',aspectRatio:'1:1',generateAudio:false};
  const started=Date.now();
  const created=await post('/v1/media/video/tasks/create',body);
  console.log(JSON.stringify({operationId,createdStatus:created.status,submitMs:Date.now()-started}));
  const duplicate=await post('/v1/media/video/tasks/create',body);
  assert.equal(duplicate.requestId,operationId,'Create replay resumes original task');
  let status;
  for(let i=0;i<150;i++) {
    status=await post('/v1/media/video/tasks/status',{taskToken});
    if(['ready','succeeded','failed'].includes(status.status))break;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  console.log(JSON.stringify({status:status.status,errorCode:status.errorCode,totalMs:Date.now()-started}));
  if(status.status==='failed')terminal=true;
  assert.ok(['ready','succeeded'].includes(status.status),'Video must reach downloadable state');
  const response=await fetch(gateway+'/v1/media/video/tasks/download',{method:'POST',
    headers:{Authorization:authorization,'Content-Type':'application/json'},
    body:JSON.stringify({taskToken,deliveryConfirmation:true}),signal:AbortSignal.timeout(180000)});
  assert.ok(response.ok,`Download HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(4,8).toString(),'ftyp','Real binary MP4 returned');
  const confirmed=await post('/v1/media/video/tasks/confirm',{taskToken,bytes:bytes.length,contentType:'video/mp4'});
  assert.ok(confirmed.settlement.creditsCharged>0);
  terminal=true;
  const accountResult=await json(gateway+'/v1/account',{headers:{Authorization:authorization}});
  const account=accountResult.account||accountResult;
  assert.equal(account.balance,Math.round((2000.86-confirmed.settlement.creditsCharged)*100)/100);
  assert.equal(account.reserved,0);
  const again=await post('/v1/media/video/tasks/confirm',{taskToken,bytes:bytes.length,contentType:'video/mp4'});
  assert.equal(again.settlement.creditsCharged,confirmed.settlement.creditsCharged);
  console.log(JSON.stringify({videoVerified:true,bytes:bytes.length,creditsCharged:confirmed.settlement.creditsCharged,duplicatesVerified:true}));
} finally {
  if(userId&&terminal) {
    const removed=await fetch(project+'/auth/v1/admin/users/'+userId,{method:'DELETE',headers:admin,signal:AbortSignal.timeout(30000)});
    console.log(JSON.stringify({auditUserRemoved:removed.ok}));
  } else if(userId) console.log(JSON.stringify({auditUserRetained:userId,reason:'Preserve pending task for recovery; no resubmission.'}));
}
