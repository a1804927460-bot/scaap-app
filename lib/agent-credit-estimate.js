'use strict';
const {calculateChatCost}=require('./chat-cost-pricing');
const {CHAT_RATES,CHAT_RATE_VERSION}=require('./chat-rates');
const {resolveAgentRoute,strongerAgentModels}=require('./agent-routing');
function estimateAgentCredits(request={}) {
  const messages=Array.isArray(request.messages)?request.messages.slice(-100):[];
  if (!request.routingStrategy && request.chatModel && !CHAT_RATES[request.chatModel]) return {available:false,reason:'unverified-rate'};
  let route;
  try {route=resolveAgentRoute({strategy:request.routingStrategy,prompt:request.prompt,messages,providers:request.providers || [{id:'estimate',models:Object.keys(CHAT_RATES)}]});} catch {return {available:false,reason:'route-unavailable'};}
  const model=route?.model || request.chatModel || request.model;
  const names=[model,...(route?strongerAgentModels(model):[])];
  if (!names.every(name=>CHAT_RATES[name])) return {available:false,reason:'unverified-rate'};
  const contentText=content=>Array.isArray(content)?content.filter(p=>p?.type==='text').map(p=>String(p.text||'')).join('\n'):String(content||'');
  let images=0,unknownAttachments=false;
  const text=messages.map(m=>{
    images+=Array.isArray(m.images)?m.images.length:0;
    const files=Array.isArray(m.attachments)?m.attachments:[];
    unknownAttachments ||= files.some(f=>f.kind!=='image' && f.content==null);
    return contentText(m.content)+'\n'+files.map(f=>String(f.content||'')).join('\n');
  }).join('\n');
  const refs=new Set([...(request.attachmentFileIds||[]),...(request.attachmentTokens||[])]).size;
  if (unknownAttachments || (refs && !request.attachmentsResolved)) return {available:false,reason:'attachments-unresolved'};
  const bytes=Buffer.byteLength(text || String(request.prompt||''),'utf8');
  // A preview range, not an exact tokenizer or a ceiling for an autonomous task.
  // Include all supplied history; never clamp a long prompt down to 24K tokens.
  const lower=Math.ceil(bytes/4)+512+images*256;
  const upper=bytes+16384+images*16384;
  const min=calculateChatCost([{inputTokens:lower,outputTokens:256}],CHAT_RATES[model]).credits;
  const max=Math.max(...names.map(name=>calculateChatCost([{inputTokens:upper,outputTokens:16384}],CHAT_RATES[name]).credits));
  return {available:true,min,max,model,models:names,scope:'initial-response',includesContinuations:false,includesTools:false,rateVersion:CHAT_RATE_VERSION,protectionPercent:20};
}
module.exports={estimateAgentCredits};
