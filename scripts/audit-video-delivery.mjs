const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) throw new Error('Missing service configuration');
const headers = { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }) };
const select = 'request_id,provider_id,provider_task_id,status,attempt_count,error_code,created_at,next_poll_at,deadline_at,result_bytes';
const response = await fetch(`${base}/rest/v1/ai_video_jobs?select=${select}&order=created_at.desc&limit=20`, { headers, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Database audit HTTP ${response.status}`);
const jobs = await response.json();
console.log(JSON.stringify({ gateway: process.env.RAILWAY_PUBLIC_DOMAIN, dbEnvNames: Object.keys(process.env).filter(k => /DATABASE|DB_URL/.test(k)), jobs: jobs.slice(0, 5).map(({ provider_task_id, ...job }) => ({ ...job, hasTask: !!provider_task_id })) }, null, 2));
for (const job of jobs.filter(j => j.provider_task_id && ['video-1', 'aireiter-video-minimax-h3'].includes(j.provider_id)).slice(0, 5)) {
  if (!process.env.AIREITER_API_KEY || !job.provider_task_id.startsWith('u_')) continue;
  const upstream = await fetch('https://aireiter.com/api/openapi/query', { method: 'POST', headers: { Authorization: `Bearer ${process.env.AIREITER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ out_task_id: job.provider_task_id }), signal: AbortSignal.timeout(30000) });
  const body = await upstream.json();
  console.log(JSON.stringify({ requestId: job.request_id, upstreamHttp: upstream.status, statusCode: body.statusCode, status: body.data?.status, keys: Object.keys(body.data || {}), outputCount: Array.isArray(body.data?.output) ? body.data.output.length : null }));
  const output = body.data?.output?.[0];
  console.log(JSON.stringify({ outputKeys: output && typeof output === 'object' ? Object.keys(output) : typeof output, completedAt: body.data?.completed_at }));
  if (job === jobs.find(j => j.provider_id === 'video-1')) {
    const { pollVideoTask } = await import('../gateway/src/providers.js');
    const result = await pollVideoTask(job.provider_id, job.provider_task_id);
    console.log(JSON.stringify({ localAdapterStatus: result.status, hasResult: !!result.resultUrl }));
    if (result.resultUrl) {
      const { downloadProviderVideoResult } = await import('../gateway/src/video-result-storage.js');
      try { const downloaded = await downloadProviderVideoResult(result.resultUrl); console.log(JSON.stringify({ downloadedBytes: downloaded.buffer.length })); }
      catch (error) { console.log(JSON.stringify({ downloadError: error.code, message: error.message })); }
    }
  }
}
