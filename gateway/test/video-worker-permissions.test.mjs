import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('recreated video worker RPC is service-only',()=>{
  const migration=readFileSync(new URL('../../supabase/migrations/202609070001_video_worker_rpc_permissions.sql',import.meta.url),'utf8');
  assert.match(migration,/revoke all on function public\.claim_due_ai_video_jobs\(text, integer, integer\)\s+from public, anon, authenticated;/i);
  assert.match(migration,/grant execute on function public\.claim_due_ai_video_jobs\(text, integer, integer\)\s+to service_role;/i);
});
