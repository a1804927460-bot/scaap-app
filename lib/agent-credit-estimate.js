'use strict';
const {calculateChatCost}=require('./chat-cost-pricing');
const { CHAT_RATES: prices } = require('./chat-rates');
function estimateAgentCredits(request={}) {
  const names=request.routingStrategy ? ['gemini-3.8-flash','gemini-3.1-pro','gpt-5.6-sol'] : [request.chatModel];
  if (!names.every(name=>prices[name])) return {available:false};
  const messages=Array.isArray(request.messages)?request.messages:[];
  const text=messages.map(m=>String(m.content||'')).join('\n') || String(request.prompt||'');
  const bytes=Buffer.byteLength(text,'utf8');
  const refs=(request.attachmentFileIds?.length||0)+(request.attachmentTokens?.length||0);
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
