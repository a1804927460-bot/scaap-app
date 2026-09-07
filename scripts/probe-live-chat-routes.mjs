import { randomBytes, randomUUID } from 'node:crypto';
import chatStream from '../lib/chat-stream.js';

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
      ok:response.ok&&Boolean(result.text?.trim()),code:result.code,usage:result.usage}));
    if (!response.ok || !result.text?.trim()) throw new Error('Live chat route failed');
  }
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
