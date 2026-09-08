'use strict';
const {calculateChatCost}=require('./chat-cost-pricing');
const { CHAT_RATES: prices } = require('./chat-rates');
const { resolveAgentRoute } = require('./agent-routing');
function estimateAgentCredits(request={}) {
  const messages=Array.isArray(request.messages)?request.messages:[];
  const route=resolveAgentRoute({strategy:request.routingStrategy,prompt:request.prompt,messages,
    providers:[{id:'estimate',models:Object.keys(prices)}]});
  const names=[route?.model || request.chatModel];
  if (!names.every(name=>prices[name])) return {available:false};
  const contentText=content=>Array.isArray(content)
    ? content.filter(part=>part?.type==='text').map(part=>String(part.text||'')).join('\n')
    : String(content||'');
  const text=messages.slice(-19).map(m=>contentText(m?.content)).join('\n') || String(request.prompt||'');
  const bytes=Buffer.byteLength(text,'utf8');
  const refs=new Set(request.attachmentFileIds||[]).size+new Set(request.attachmentTokens||[]).size;
  const lower=Math.min(24000,Math.ceil(bytes/4)+512+refs*256);
  const upper=Math.min(24000,bytes+2048+refs*4096);
  const values=names.flatMap(name=>{
    const rates=prices[name];
    return [calculateChatCost([{inputTokens:lower,outputTokens:256}],rates).credits,
      calculateChatCost([{inputTokens:upper,outputTokens:4096}],rates).credits];
  });
  return {available:true,min:Math.min(...values),max:Math.max(...values),scope:'initial-response',protectionPercent:20};
}
module.exports={estimateAgentCredits};
