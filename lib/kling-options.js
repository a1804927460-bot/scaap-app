'use strict';
// Atlas account /model/calculate verified 2026-09-09, USD per second.
// Sound and SR have separate prices. Never use the marketplace "from" price.
const KLING_VARIANTS = Object.freeze({
  standard: {label:'V3 标准',model:'kwaivgi/kling-v3.0-std/image-to-video',durations:[5,10],sound:true,endFrame:true,rates:{'720P':[0.0714,0.1071],'1080P-SR':[0.08568,0.12852],'1440P-SR':[0.1523176,0.2284764]}},
  pro: {label:'V3 Pro',model:'kwaivgi/kling-v3.0-pro/image-to-video',durations:[5,10],sound:true,endFrame:true,rates:{'1080P':[0.0952,0.1428],'1440P-SR':[0.1353934,0.2030902]}},
  turbo: {label:'V3 Turbo',model:'kwaivgi/kling-v3.0-turbo/image-to-video',durations:[5,10],sound:false,endFrame:false,rates:{'720P':[0.0952,0.0952],'1080P':[0.119,0.119]}},
  'v3-4k': {label:'V3 4K',model:'kwaivgi/kling-v3.0-4k/image-to-video',durations:Array.from({length:13},(_,i)=>i+3),sound:true,endFrame:true,rates:{'4K':[0.357,0.357]}},
  'o3-4k': {label:'O3 4K',model:'kwaivgi/kling-video-o3-4k/image-to-video',durations:Array.from({length:13},(_,i)=>i+3),sound:true,endFrame:true,rates:{'4K':[0.357,0.357]}}
});
function invalid(message) { return Object.assign(new Error(message),{code:'provider-option-not-supported',status:400,safeToFallback:true}); }
function klingSelection(request={}) {
  const tier=String(request.serviceTier || 'standard').trim().toLowerCase();
  const variant=KLING_VARIANTS[tier];
  if(!variant) throw invalid('Unsupported Kling version.');
  const resolution=String(request.resolution || request.size || Object.keys(variant.rates)[0]).trim().toUpperCase();
  if(!Object.hasOwn(variant.rates,resolution)) throw invalid('This Kling version does not support the selected resolution.');
  const duration=Number(request.duration ?? 5);
  if(!variant.durations.includes(duration)) throw invalid('This Kling version does not support the selected duration.');
  const sound=request.generateAudio===true;
  if(sound&&!variant.sound) throw invalid('Kling Turbo does not expose a sound option.');
  const usdPerSecond=variant.rates[resolution][sound?1:0];
  return {tier,variant,resolution,duration,sound,usdPerSecond,billingId:`atlas-kling-${tier}-${sound?'audio':'silent'}`};
}
function klingInput(request={}) {
  const selected=klingSelection(request);
  const urls=Array.isArray(request.urls)?request.urls:[];
  if(urls.length<1 || urls.length>(selected.variant.endFrame?2:1)) throw invalid('Select a start frame and, for supported versions, one end frame.');
  if((request.referenceMediaTypes || []).some(t=>t!=='image') || request.audioUrls?.length) throw invalid('Kling image-to-video accepts only image frames.');
  const mode=request.videoMode || (urls.length===2?'first-last-frame':'first-frame');
  if(!['first-frame','first-last-frame'].includes(mode) || (mode==='first-last-frame')!==(urls.length===2)) throw invalid('Kling frame selection does not match the generation mode.');
  if(request.aspectRatio && !['auto','adaptive'].includes(request.aspectRatio)) throw invalid('Kling follows the source image aspect ratio.');
  const prompt=String(request.prompt || '').trim();
  if(!prompt || prompt.length>2500) throw invalid('Kling requires a prompt of 1–2500 characters.');
  const payload={model:selected.variant.model,prompt,image:urls[0],duration:selected.duration};
  if(urls[1]) payload.end_image=urls[1];
  if(selected.variant.sound) payload.sound=selected.sound;
  if(['standard','pro','turbo'].includes(selected.tier)) payload.resolution=selected.tier==='turbo'?selected.resolution.toLowerCase():selected.resolution;
  // 4K is selected by its model endpoint; do not send the schema's stale 1080P default.
  return { ...selected,payload };
}
module.exports={KLING_VARIANTS,klingSelection,klingInput};
