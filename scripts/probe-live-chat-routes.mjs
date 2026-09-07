import { randomBytes, randomUUID } from 'node:crypto';
import chatStream from '../lib/chat-stream.js';
import assert from 'node:assert/strict';
import { chatCreditRpc } from '../gateway/src/chat-billing.js';

if (process.env.MESSS_LIVE_CHAT_AUDIT !== '1') throw new Error('Set MESSS_LIVE_CHAT_AUDIT=1 to allow paid upstream chat smoke tests.');
const project = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const gateway = process.env.MESSS_AI_GATEWAY_URL;
if (![project, secret, publicKey, gateway].every(Boolean)) throw new Error('Missing live audit configuration.');
const email = `messs-route-audit-${randomUUID()}@example.com`;
const password = randomBytes(32).toString('hex');
const adminHeaders = {apikey:secret, Authorization:`Bearer ${secret}`, 'Content-Type':'application/json'};
let userId;
try {
  const created = await fetch(`${project}/auth/v1/admin/users`, {
    method:'POST',headers:adminHeaders,
    body:JSON.stringify({email,password,email_confirm:true,user_metadata:{purpose:'messs-route-audit'}}),
    signal:AbortSignal.timeout(30000)
  });
  if (!created.ok) throw new Error(`Audit user creation HTTP ${created.status}`);
  const user = await created.json();userId=user.id;
  if (!userId) throw new Error('Audit user id missing');
  const login = await fetch(`${project}/auth/v1/token?grant_type=password`, {
    method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json'},
    body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)
  });
  if (!login.ok) throw new Error(`Audit login HTTP ${login.status}`);
  const session = await login.json();
  const denied = await fetch(`${gateway}/v1/chat`,{method:'POST',
    headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
    body:JSON.stringify({providerId:'chat-4',model:'gpt-5.6-sol',prompt:'Reply OK.'}),signal:AbortSignal.timeout(30000)});
  assert.equal(denied.status,402,'Zero balance must not reach the paid upstream');
  const funded = await fetch(`${project}/rest/v1/ai_credit_accounts?user_id=eq.${userId}`,{
    method:'PATCH',headers:adminHeaders,body:JSON.stringify({balance:100}),signal:AbortSignal.timeout(30000)});
  assert.ok(funded.ok,'Fund only the disposable audit account');
  const grant = await fetch(`${project}/rest/v1/ai_credit_ledger`,{method:'POST',headers:adminHeaders,
    body:JSON.stringify({user_id:userId,event_type:'grant',balance_delta:100,reserved_delta:0,balance_after:100,
      reserved_after:0,idempotency_key:`audit:${userId}`}),signal:AbortSignal.timeout(30000)});
  assert.ok(grant.ok);
  const requests=[randomUUID(),randomUUID()];
  const reservations=await Promise.all(requests.map(id=>chatCreditRpc('reserve_ai_chat_credits',{
    p_user_id:userId,p_request_id:id,p_claim_id:randomUUID(),p_fingerprint:'a'.repeat(64),p_budget:60,p_update:false,p_provider_id:'chat-4'})));
  assert.equal(reservations.filter(r=>r.ok).length,1,'Concurrent reservations must not overspend');
  for(let i=0;i<requests.length;i++) if(reservations[i].ok) await chatCreditRpc('settle_ai_chat_credits',{
    p_user_id:userId,p_request_id:requests[i],p_receipt:null,p_duration_ms:0});
  let expectedBalance=100;
  const streaming = process.env.MESSS_LIVE_CHAT_STREAM === '1';
  const prompt = streaming ? 'Explain how a queue works in six short sentences. Use plain language.' : 'Reply with OK only.';
  for (const strategy of ['fast','balanced','ultimate']) {
    const started=Date.now(), requestId=randomUUID();
    let firstDeltaMs=null, deltaCount=0;
    const response=await fetch(`${gateway}/v1/chat`,{
      method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json','X-Idempotency-Key':requestId,
        Accept:streaming?'text/event-stream':'application/json'},
      body:JSON.stringify({providerId:'chat-6',model:'gemini-3.8-flash',routingStrategy:strategy,
        prompt,messages:[{role:'user',content:prompt}]}),
      signal:AbortSignal.timeout(120000)
    });
    const headersMs=Date.now()-started;
    if(streaming && !/text\/event-stream/i.test(response.headers.get('content-type')||'')) throw new Error(`SSE not enabled (HTTP ${response.status})`);
    const result=streaming?await chatStream.readGatewayChatStream(response,text=>{
      if(text){firstDeltaMs??=Date.now()-started;deltaCount++;}
    }):await response.json();
    console.log(JSON.stringify({strategy,requestId,status:response.status,durationMs:Date.now()-started,
      ...(streaming?{headersMs,firstDeltaMs,deltaCount}:{}),
      ok:response.ok&&Boolean(result.text?.trim()),code:result.code,usage:result.usage,creditsCharged:result.creditsCharged}));
    if (!response.ok || !result.text?.trim()) throw new Error('Live chat route failed');
    assert.ok(result.creditsCharged>0,'Successful AI use must charge actual credits');
    expectedBalance=Math.round((expectedBalance-result.creditsCharged)*100)/100;
    const accountResponse=await fetch(`${gateway}/v1/account`,{headers:{Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(30000)});
    const accountPayload=await accountResponse.json();
    const account=accountPayload.account||accountPayload;
    assert.equal(account.balance,expectedBalance,'Real account balance matches exact debits');
    assert.equal(account.reserved,0,'Unused credits released');
    const duplicate=await fetch(`${gateway}/v1/chat`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,
      'Content-Type':'application/json','X-Idempotency-Key':requestId},
      body:JSON.stringify({providerId:'chat-6',model:'gemini-3.8-flash',routingStrategy:strategy,prompt,messages:[{role:'user',content:prompt}]}),
      signal:AbortSignal.timeout(30000)});
    assert.equal(duplicate.status,409,'Duplicate operation must not execute or debit again');
  }
  const ledgerResponse=await fetch(`${project}/rest/v1/ai_credit_ledger?user_id=eq.${userId}&event_type=eq.charge&select=balance_delta`,{
    headers:adminHeaders,signal:AbortSignal.timeout(30000)});
  const ledger=await ledgerResponse.json();
  assert.equal(ledger.length,3);
  assert.equal(Math.round((100+ledger.reduce((sum,row)=>sum+row.balance_delta,0))*100)/100,expectedBalance);
  console.log(JSON.stringify({billingVerified:true,expectedBalance,charges:ledger.length,concurrencyVerified:true,duplicatesRejected:true}));
} finally {
  if (userId) {
    let removed=false;
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const response=await fetch(`${project}/auth/v1/admin/users/${encodeURIComponent(userId)}`,{
          method:'DELETE',headers:adminHeaders,signal:AbortSignal.timeout(30000)
        });
        if(response.ok||response.status===404){removed=true;break;}
      } catch {}
    }
    console.log(JSON.stringify({auditUserRemoved:removed}));
    if(!removed)throw new Error(`Remove the temporary audit user ${userId}`);
  }
}
