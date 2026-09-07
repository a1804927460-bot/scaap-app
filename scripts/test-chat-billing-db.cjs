'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
if(!process.argv.includes('--linked'))throw new Error('Explicit --linked required; all changes are rolled back.');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/202609070002_metered_agent_chat.sql'),'utf8');
const tests=fs.readFileSync(path.join(__dirname,'test-chat-billing-db.sql'),'utf8');
const sql=process.argv.includes('--existing')?'begin;\n'+tests+'\nrollback;':migration.replace(/commit;\s*$/i,()=>tests+'\nrollback;');
const cli=process.env.SUPABASE_CLI || path.resolve(root,'../supabase-cli/supabase.exe');
const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'messs-billing-test-'));
const fixture=path.join(directory,'rollback.sql');
try {
  fs.writeFileSync(fixture,sql);
  process.stdout.write(execFileSync(cli,['db','query','--linked','--file',fixture,'--output','json'],{cwd:root,encoding:'utf8',maxBuffer:5*1024*1024}));
} finally { fs.unlinkSync(fixture); fs.rmdirSync(directory); }
