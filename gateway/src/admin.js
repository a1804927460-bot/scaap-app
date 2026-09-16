import { getUsageAccount, getUsageSummary } from './usage.js';
import { providerRuntimeStatus, providerBalanceStatus, registerRuntimeProvider, rollbackProviderRuntimeRoute, setProviderRuntimeRoute } from './providers.js';
import { readStoredImageResult } from './image-result-storage.js';
import { downloadProviderVideoResult, readStoredVideoResult, storeVideoResult } from './video-result-storage.js';

const ADMIN_EMAIL = 'a1804927460@gmail.com';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');
const balanceCache = { expiresAt:0, value:null, pending:null };

export function isAdminUser(user) {
  return Boolean(user?.id && String(user.email || '').trim().toLowerCase() === ADMIN_EMAIL);
}

function fail(code, status, message) { return Object.assign(new Error(message), { code, status }); }
function serviceHeaders() {
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!key) throw fail('admin-service-not-configured', 503, '管理员数据服务尚未配置。');
  return { apikey:key, ...(key.startsWith('sb_secret_') ? {} : { Authorization:`Bearer ${key}` }), Accept:'application/json', 'Content-Type':'application/json' };
}
async function serviceFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers:{ ...serviceHeaders(), ...(options.headers || {}) }, signal:options.signal || AbortSignal.timeout(10000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw fail('admin-service-failed', response.status, String(payload?.message || payload?.msg || '管理员数据服务暂时不可用。'));
  return { payload, headers:response.headers };
}
async function restRows(table, params, allowMissing = false) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  Object.entries(params).forEach(([key,value]) => url.searchParams.set(key, value));
  try { const { payload } = await serviceFetch(url); return Array.isArray(payload) ? payload : []; }
  catch (error) { if (allowMissing && error.status === 404) return []; throw error; }
}
async function patchRows(table, filters, body) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  Object.entries(filters).forEach(([key,value]) => url.searchParams.set(key, value));
  await serviceFetch(url, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(body) });
}
async function rpc(name, body) {
  const { payload } = await serviceFetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method:'POST', body:JSON.stringify(body) });
  return payload;
}
async function cachedProviderBalances() {
  const now=Date.now();
  if (balanceCache.value && balanceCache.expiresAt > now) return balanceCache.value;
  if (!balanceCache.pending) balanceCache.pending=providerBalanceStatus().then(value=>{
    balanceCache.value=value; balanceCache.expiresAt=Date.now()+30_000; return value;
  }).finally(()=>{ balanceCache.pending=null; });
  return balanceCache.pending;
}
function safeUser(user = {}, account = null, profile = null) {
  const balance = Math.max(0, Number(account?.balance) || 0);
  const reserved = Math.max(0, Number(account?.reserved) || 0);
  const metadata = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  return { id:String(user.id || ''), email:String(user.email || '').slice(0,320) || null,
    displayName:String(profile?.display_name || metadata.display_name || metadata.name || '').slice(0,80) || null,
    createdAt:String(user.created_at || '').slice(0,40) || null, lastSignInAt:String(user.last_sign_in_at || '').slice(0,40) || null,
    confirmed:Boolean(user.email_confirmed_at || user.confirmed_at), account:account ? { balance, reserved, availableCredits:Math.max(0,balance-reserved), membershipTier:String(account.membership_tier || 'free').slice(0,40), updatedAt:String(account.updated_at || '').slice(0,40) || null } : null };
}

export async function listAdminUsers({ page=1, perPage=25, search='' } = {}) {
  const p = Math.max(1, Math.round(Number(page)||1)); const size = Math.max(1,Math.min(100,Math.round(Number(perPage)||25)));
  const url = new URL(`${supabaseUrl}/auth/v1/admin/users`); url.searchParams.set('page',p); url.searchParams.set('per_page',size);
  const { payload, headers } = await serviceFetch(url);
  let users = Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : [];
  const query = String(search || '').trim().toLowerCase();
  if (query) users = users.filter(user => [user.id,user.email,user.user_metadata?.name,user.user_metadata?.display_name].some(value => String(value||'').toLowerCase().includes(query)));
  const ids = users.filter(user => UUID.test(user.id)).map(user => user.id);
  const filter = ids.length ? `in.(${ids.join(',')})` : '';
  const [accounts, profiles] = await Promise.all([filter ? restRows('ai_credit_accounts',{user_id:filter,select:'user_id,balance,reserved,membership_tier,updated_at'}) : [], filter ? restRows('profiles',{id:filter,select:'id,display_name'},true) : []]);
  const byAccount = new Map(accounts.map(row => [row.user_id,row])); const byProfile = new Map(profiles.map(row => [row.id,row]));
  const total = Number(payload?.total) || Number(String(headers.get('content-range')||'').split('/').pop()) || users.length;
  return { page:p, perPage:size, total, users:users.map(user => safeUser(user,byAccount.get(user.id),byProfile.get(user.id))) };
}

function productNames() { return new Map(providerRuntimeStatus().routes.map(route => [`${route.kind}:${route.providerId}`,route.name])); }
function taskRow(row, jobs, names) {
  const job = jobs.get(String(row.request_id || '')); const kind = String(row.kind || 'other');
  const storageRef = kind === 'video' ? job?.result_storage_ref : job?.result_url;
  const stored = /^storage:\/\/messs-ai-(?:image|video)-results\//i.test(String(storageRef || ''));
  const media = ['image','video'].includes(kind) && String(row.status || '') === 'succeeded';
  const recoverable = media && Boolean(job);
  return { requestId:String(row.request_id||''), userId:String(row.user_id||''), kind, status:String(row.status||''),
    providerId:String(row.provider_id||'') || null, productName:names.get(`${kind}:${row.provider_id}`) || String(row.provider_id||'') || null,
    actualProviderId:String(job?.provider_id||'') || null, resolution:String(row.resolution||'') || null,
    durationSeconds:Math.max(0,Number(row.duration_seconds)||0), creditsReserved:Math.max(0,Number(row.credits_reserved)||0), creditsCharged:Math.max(0,Number(row.credits_charged)||0),
    createdAt:String(row.created_at||''), completedAt:String(row.completed_at||'')||null,
    previewAvailable:stored || recoverable, previewKind:stored || recoverable ? kind : null,
    previewState:stored ? 'stored' : recoverable ? 'recoverable' : 'unavailable',
    contentType:String(job?.result_content_type||'')||null, resultBytes:Number(job?.result_bytes)||null };
}

export async function listAdminTasks({page=1,perPage=100,kind='',status='',mediaOnly=''}={}) {
  const p=Math.max(1,Math.round(Number(page)||1)); const size=Math.max(1,Math.min(100,Math.round(Number(perPage)||100)));
  const url=new URL(`${supabaseUrl}/rest/v1/ai_usage`);
  url.searchParams.set('select','request_id,user_id,kind,status,provider_id,resolution,duration_seconds,credits_reserved,credits_charged,created_at,completed_at');
  url.searchParams.set('order','created_at.desc'); url.searchParams.set('offset',(p-1)*size); url.searchParams.set('limit',size);
  if (['chat','image','video','3d'].includes(String(kind))) url.searchParams.set('kind',`eq.${kind}`);
  else if (String(mediaOnly) === '1') url.searchParams.set('kind','in.(image,video,3d)');
  if (status) url.searchParams.set('status',`eq.${String(status).slice(0,24)}`);
  const {payload,headers}=await serviceFetch(url,{headers:{Prefer:'count=exact'}}); const rows=Array.isArray(payload)?payload:[];
  const ids=rows.map(row=>row.request_id).filter(value=>UUID.test(value)); const filter=ids.length?`in.(${ids.join(',')})`:'';
  const [images,videos]=await Promise.all([filter?restRows('ai_image_jobs',{request_id:filter,select:'request_id,provider_id,result_url'},true):[],filter?restRows('ai_video_jobs',{request_id:filter,select:'request_id,provider_id,result_storage_ref,result_content_type,result_bytes'},true):[]]);
  const jobs=new Map([...images,...videos].map(row=>[String(row.request_id),row])); const names=productNames();
  const match=/\/(\d+)$/.exec(String(headers.get('content-range')||''));
  return {page:p,perPage:size,total:match?Number(match[1]):rows.length,tasks:rows.map(row=>taskRow(row,jobs,names))};
}

export async function getAdminUserUsage(userId,range='30d') {
  if (!UUID.test(userId)) throw fail('invalid-user-id',400,'用户标识无效。');
  const {payload}=await serviceFetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`);
  const [account,summary,events]=await Promise.all([getUsageAccount(userId),getUsageSummary(userId,range),restRows('ai_usage',{user_id:`eq.${userId}`,select:'request_id,kind,status,provider_id,credits_reserved,credits_charged,created_at,completed_at',order:'created_at.desc',limit:'100'})]);
  return {user:safeUser(payload?.user||payload,account),account,summary,events};
}

async function mediaForRequest(requestId) {
  const usage=await restRows('ai_usage',{request_id:`eq.${requestId}`,select:'request_id,user_id,kind,status',limit:'1'});
  const row=usage[0]; if (!row || !['image','video'].includes(row.kind)) throw fail('result-not-found',404,'未找到生成结果。');
  if (row.kind==='image') {
    const jobs=await restRows('ai_image_jobs',{request_id:`eq.${requestId}`,user_id:`eq.${row.user_id}`,select:'request_id,result_url',limit:'1'},true);
    const buffer=await readStoredImageResult(row.user_id,requestId,jobs[0]?.result_url || null);
    const contentType=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':buffer.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':buffer.subarray(0,4).toString('ascii')==='RIFF'?'image/webp':buffer.subarray(4,12).toString('ascii').startsWith('ftypavif')?'image/avif':'application/octet-stream';
    if (jobs[0] && !/^storage:\/\/messs-ai-image-results\//i.test(String(jobs[0].result_url||''))) {
      const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/avif':'avif'}[contentType];
      if (extension) await patchRows('ai_image_jobs',{request_id:`eq.${requestId}`,user_id:`eq.${row.user_id}`},{result_url:`storage://messs-ai-image-results/${row.user_id}/${requestId}.${extension}`,updated_at:new Date().toISOString()}).catch(()=>{});
    }
    return {buffer,contentType};
  }
  const jobs=await restRows('ai_video_jobs',{request_id:`eq.${requestId}`,user_id:`eq.${row.user_id}`,select:'result_url,result_storage_ref,result_content_type',limit:'1'},true);
  const job=jobs[0];
  try {
    const media=await readStoredVideoResult(row.user_id,requestId,job?.result_storage_ref || null);
    if (job && media.storageRef && media.storageRef !== job.result_storage_ref) {
      await rpc('record_ai_video_provider_storage',{p_request_id:requestId,p_storage_ref:media.storageRef,p_result_content_type:media.contentType,p_result_bytes:media.buffer.length}).catch(()=>{});
    }
    return media;
  } catch (error) {
    if (error.status !== 404 || !job?.result_url) throw error;
    const downloaded=await downloadProviderVideoResult(job.result_url);
    const storageRef=await storeVideoResult(row.user_id,requestId,downloaded.buffer,downloaded.contentType);
    await rpc('record_ai_video_provider_storage',{p_request_id:requestId,p_storage_ref:storageRef,p_result_content_type:downloaded.contentType,p_result_bytes:downloaded.buffer.length}).catch(()=>{});
    return downloaded;
  }
}

function sendMedia(request,response,media,send) {
  const total=media.buffer.length; const match=/^bytes=(\d*)-(\d*)$/i.exec(String(request.headers.range||''));
  if (!match) return send(response,200,media.buffer,{'Content-Type':media.contentType,'Accept-Ranges':'bytes','Content-Disposition':'inline'});
  const start=match[1]?Number(match[1]):Math.max(0,total-Number(match[2]||0)); const end=match[2]&&match[1]?Math.min(total-1,Number(match[2])):total-1;
  if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=total) return send(response,416,{code:'invalid-media-range',message:'媒体范围无效。'},{'Content-Range':`bytes */${total}`});
  return send(response,206,media.buffer.subarray(start,end+1),{'Content-Type':media.contentType,'Content-Range':`bytes ${start}-${end}/${total}`,'Accept-Ranges':'bytes','Content-Disposition':'inline'});
}

export async function handleAdminRequest({request,response,url,user,readJson,send}) {
  if (!url.pathname.startsWith('/v1/admin/')) return false;
  if (!isAdminUser(user)) { send(response,403,{code:'admin-required',message:'此账号没有管理员权限。'}); return true; }
  try {
    if(request.method==='GET'&&url.pathname==='/v1/admin/status') return send(response,200,{ok:true,admin:true,userId:user.id,runtime:providerRuntimeStatus()}),true;
    if(request.method==='GET'&&url.pathname==='/v1/admin/providers') return send(response,200,providerRuntimeStatus()),true;
    if(request.method==='GET'&&url.pathname==='/v1/admin/providers/balances') return send(response,200,await cachedProviderBalances()),true;
    if(request.method==='POST'&&url.pathname==='/v1/admin/providers') return send(response,201,registerRuntimeProvider(await readJson(request),user.email)),true;
    if(request.method==='POST'&&url.pathname==='/v1/admin/providers/switch'){const b=await readJson(request);return send(response,200,setProviderRuntimeRoute(b.kind,b.providerId,b.upstreamProviderIds,user.email,b.routeId,b.routeProfile)),true;}
    if(request.method==='POST'&&url.pathname==='/v1/admin/providers/rollback'){const b=await readJson(request);return send(response,200,rollbackProviderRuntimeRoute(b.kind,b.providerId,user.email,b.routeId,b.routeProfile)),true;}
    if(request.method==='GET'&&url.pathname==='/v1/admin/users') return send(response,200,await listAdminUsers(Object.fromEntries(url.searchParams))),true;
    if(request.method==='GET'&&url.pathname==='/v1/admin/tasks') return send(response,200,await listAdminTasks(Object.fromEntries(url.searchParams))),true;
    const usage=/^\/v1\/admin\/users\/([0-9a-f-]{36})\/usage$/i.exec(url.pathname); if(request.method==='GET'&&usage)return send(response,200,await getAdminUserUsage(usage[1],url.searchParams.get('range')||'30d')),true;
    const result=/^\/v1\/admin\/results\/([0-9a-f-]{36})\/content$/i.exec(url.pathname); if(request.method==='GET'&&result){sendMedia(request,response,await mediaForRequest(result[1]),send);return true;}
    send(response,404,{code:'admin-route-not-found',message:'管理员接口不存在，请同步最新版网关。'}); return true;
  } catch(error) { send(response,Math.max(400,Math.min(599,Number(error.status)||500)),{code:String(error.code||'admin-request-failed'),message:String(error.message||'管理员请求失败。')}); return true; }
}
