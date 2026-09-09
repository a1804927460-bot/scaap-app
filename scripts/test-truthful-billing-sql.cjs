const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('assert/strict');
const {calculateChatCost}=require('../lib/chat-cost-pricing');
const {CHAT_RATES}=require('../lib/chat-rates');
(async()=>{const db=new PGlite();try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table ai_credit_accounts(user_id uuid primary key,balance numeric,reserved numeric,updated_at timestamptz,overseas_unlocked boolean,membership_tier text);
 create table ai_usage(request_id uuid primary key,user_id uuid,kind text,provider_id text,canvas_id text,status text,credits_reserved numeric,credits_charged numeric,duration_ms integer,duration_seconds integer,resolution text,completed_at timestamptz,created_at timestamptz default now());
 create table ai_chat_billing(request_id uuid,user_id uuid,receipt jsonb,updated_at timestamptz);
 create table ai_credit_ledger(user_id uuid,event_type text,balance_delta numeric,reserved_delta numeric,balance_after numeric,reserved_after numeric,request_id uuid,reference_id text,idempotency_key text unique,metadata jsonb);`);
 await db.exec(fs.readFileSync('supabase/migrations/202609090004_truthful_canvas_usage.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202609090005_chat_usage_turns.sql','utf8'));
 const user='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
 for(const model of Object.keys(CHAT_RATES)) for(const turns of [[{inputTokens:4400,outputTokens:66,cachedInputTokens:4224}],[{inputTokens:150000,outputTokens:256},{inputTokens:150000,outputTokens:256}],[{inputTokens:280000,outputTokens:500,cachedInputTokens:100000}]]) {
   const usage=turns.reduce((s,t)=>({inputTokens:s.inputTokens+t.inputTokens,outputTokens:s.outputTokens+t.outputTokens,cachedInputTokens:s.cachedInputTokens+(t.cachedInputTokens||0)}),{inputTokens:0,outputTokens:0,cachedInputTokens:0});
   const receipt={...calculateChatCost(turns,CHAT_RATES[model]),rate:CHAT_RATES[model],usage,turns,model,providerId:'chat-9'};
   const q=await db.query('select quote_ai_chat_receipt_credits($1) as credits',[receipt]);assert.equal(Number(q.rows[0].credits),receipt.credits,model);
 }
 const turns=[{inputTokens:4400,outputTokens:66,cachedInputTokens:4224}];const receipt={...calculateChatCost(turns,CHAT_RATES['gpt-5.6-sol']),rate:CHAT_RATES['gpt-5.6-sol'],usage:turns[0],turns,providerId:'chat-4'};
 await db.query('insert into ai_credit_accounts(user_id,balance,reserved) values($1,100,10)',[user]);
 await db.query("insert into ai_usage(request_id,user_id,kind,provider_id,canvas_id,status,credits_reserved,credits_charged) values($1,$2,'chat','chat-4','canvas-test','reserved',10,0)",[id,user]);
 await db.query('insert into ai_chat_billing(request_id,user_id) values($1,$2)',[id,user]);
 for(let i=0;i<2;i++){const r=await db.query('select settle_ai_chat_credits($1,$2,$3,100) as r',[user,id,receipt]);assert.equal(r.rows[0].r.creditsCharged,.14);}
 assert.equal((await db.query('select count(*)::integer n from ai_credit_ledger')).rows[0].n,1);
 const report=(await db.query("select get_canvas_ai_usage_summary($1,'canvas-test') as r",[user])).rows[0].r;
 assert.equal(report.totals.creditsCharged,.14);assert.equal(report.details[0].kind,'chat');assert.equal(report.details[0].creditsCharged,.14);
 const other=(await db.query("select get_canvas_ai_usage_summary($1,'canvas-test') as r",[id])).rows[0].r;assert.equal(other.details.length,0);
 receipt.turns=[{...turns[0],cachedInputTokens:99999}];assert.equal((await db.query('select quote_ai_chat_receipt_credits($1) as n',[receipt])).rows[0].n,null);
 console.log('21 chat pricing combinations match SQL; fractional canvas receipts, user isolation and idempotent settlement passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
