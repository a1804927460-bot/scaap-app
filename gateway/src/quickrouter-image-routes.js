import {createHash} from 'node:crypto';
const DEFINITIONS = Object.freeze([
  {suffix:'nano-pro',parent:'image-1',logicalModel:'nano-banana-pro',model:'gemini-3-pro-image-preview'},
  {suffix:'nano-2',parent:'image-2',logicalModel:'nano-banana-2',model:'gemini-3.1-flash-image-preview'}
].flatMap(model=>[1,2].map(group=>({...model,id:`quickrouter-${model.suffix}-${group}`,group:`Discounted-Banana-${group}`,keyEnv:`QUICKROUTER_BANANA_${group}_API_KEY`}))));
const RATIOS=new Set(['auto','1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9']);
const rateTable=value=>Object.fromEntries(Object.entries(value||{}).filter(([size,cost])=>['1K','2K','4K'].includes(size)&&Number.isFinite(cost)&&cost>0&&cost<=10));
export function quickRouterImageRoutes(env=process.env,now=Date.now()) {
  let profiles={};try{profiles=JSON.parse(env.QUICKROUTER_IMAGE_VERIFIED_PROFILES||'{}');}catch{}
  return DEFINITIONS.map(def=>{
    const profile=profiles?.[def.id],key=String(env[def.keyEnv]||'').trim();
    const verified=profile&&key&&profile.group===def.group
      && profile.keySha256===createHash('sha256').update(key).digest('hex')
      && Number.isFinite(Date.parse(profile.verifiedAt)) && Date.parse(profile.verifiedAt)<=now
      && Date.parse(profile.expiresAt)>now && Date.parse(profile.expiresAt)-Date.parse(profile.verifiedAt)<=7*86400000
      && Number.isFinite(profile.publishedUnitUsd)&&profile.publishedUnitUsd>0;
    const costs=verified?rateTable(profile.usdBySize):{};
    const editCosts=verified?rateTable(profile.editUsdBySize):{};
    const ratios=verified&&Array.isArray(profile.ratios)?profile.ratios.filter(x=>RATIOS.has(x)):[];
    const maxRefs=verified&&Number.isInteger(profile.maxReferenceImages)?Math.max(0,Math.min(8,profile.maxReferenceImages)):0;
    return {id:def.id,kind:'image',name:'Image generation route',hidden:true,routeAliasOf:def.parent,
      logicalModel:def.logicalModel,model:def.model,protocol:'gemini-native',keyEnv:def.keyEnv,
      endpoint:`https://api.quickrouter.ai/v1beta/models/${def.model}:generateContent`,fallbackProviderIds:[],
      capabilities:{sizes:Object.keys(costs),resolutionPresets:Object.keys(costs),ratios,maxReferenceImages:maxRefs,supportsEdit:maxRefs>0&&Object.keys(editCosts).length>0},
      quickRouterGroup:def.group,quickRouterCosts:costs,quickRouterEditCosts:editCosts,
      quickRouterPublishedUnitUsd:verified?profile.publishedUnitUsd:null,
      quickRouterVerified:Boolean(verified&&ratios.length&&Object.keys(costs).length)};
  });
}
const unavailable=(message='QuickRouter pricing cannot be verified before submission.')=>Object.assign(new Error(message),{code:'provider-price-unverified',status:503,preSubmissionFailure:true,safeToFallback:true});
export function createQuickRouterPriceGuard({fetchImpl=(...args)=>fetch(...args),now=Date.now,ttlMs=30000}={}) {
  let cached=null,pending=null,expires=0;
  return async function guard(route,signal) {
    if(!route.quickRouterVerified)throw unavailable();
    if(!cached||expires<=now()) {
      pending ||= Promise.resolve().then(async()=>{
        const response=await fetchImpl('https://api.quickrouter.ai/api/pricing',{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw unavailable();const data=await response.json();
        if(data.success!==true||!Array.isArray(data.data))throw unavailable();
        cached=data;expires=now()+ttlMs;return data;
      }).finally(()=>{pending=null;});
      try {await pending;}catch{throw unavailable();}
    }
    if(signal?.aborted)throw signal.reason||unavailable();
    const model=cached.data.find(x=>x.model_name===route.model);
    const ratio=cached.group_ratio?.[route.quickRouterGroup];
    const cost=model?.model_price*ratio;
    if(model?.quota_type!==1||!model.enable_groups?.includes(route.quickRouterGroup)||!Number.isFinite(cost)||cost<=0||cost>route.quickRouterPublishedUnitUsd+1e-9)throw unavailable('QuickRouter group price or access changed before submission.');
  };
}
