const assert=require('node:assert/strict');
const {AiGatewayClient}=require('../lib/ai-gateway-client');
(async()=>{
 const original=setTimeout;
 global.setTimeout=(fn,ms,...args)=>original(fn,Math.min(ms,2),...args);
 try {
  const client=new AiGatewayClient({});
  let creates=0,polls=0,downloads=0,token;
  const buffer=Buffer.alloc(1024);buffer.write('ftyp',4);
  client.idempotentPaidRequest=async(path,options)=>{creates++;token=options.body.taskToken;return {status:'queued'};};
  client.request=async(path,options)=>{
   assert.equal(options.body.taskToken,token);
   if(path.endsWith('/status')){
    assert.equal(options.timeoutMs,15000);polls++;
    if(polls===1)throw Object.assign(new Error('Connection stalled'),{code:'gateway-timeout'});
    return {status:'succeeded'};
   }
   assert.ok(path.endsWith('/download'));assert.equal(options.timeoutMs,180000);downloads++;
   if(downloads===1)throw Object.assign(new Error('Download interrupted'),{code:'gateway-timeout'});
   return buffer;
  };
  const result=await client.generateVideo({providerId:'minimax-h3'});
  assert.equal(result,buffer);assert.equal(creates,1);assert.equal(polls,2);assert.equal(downloads,2);
  assert.equal(result.deliveryTaskToken,token);
  console.log('Video retries passed: bounded requests, unchanged task token, one paid submission, interrupted download recovery.');
 }finally{global.setTimeout=original;}
})().catch(error=>{console.error(error);process.exitCode=1;});
