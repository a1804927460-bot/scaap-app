const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict'),pricing=require('../lib/credit-pricing');
const extract=(s,n)=>{let a=s.indexOf('create or replace function public.'+n+'('),b=s.indexOf('$$;',s.indexOf('as $$',a));assert.ok(a>=0&&b>a);return s.slice(a,b+3)};
(async()=>{const db=new PGlite();try{
const base=fs.readFileSync('supabase/migrations/202609090001_economy_media_pricing.sql','utf8');
for(const name of ['quote_media_retail_credits_from_cny','quote_media_retail_credits_from_usd','quote_retail_credits_from_upstream_points','quote_image_operating_cost_upstream_points','quote_ai_image_unit_credits'])await db.exec(extract(base,name));
await db.exec(`create function public.reserve_priced_ai_credits_internal(uuid,text,text,uuid,text,integer,integer,integer) returns jsonb language sql as $$ select jsonb_build_object('ok',$7=$8,'credits',$8) $$;`);
await db.exec(extract(fs.readFileSync('supabase/migrations/202609140001_mode_image_reservation.sql','utf8'),'reserve_ai_mode_media_credits'));
let cases=0;for(const providerId of ['image-1','image-2','image-6','image-19'])for(const size of ['1K','2K','4K'])for(const performanceMode of ['normal','performance'])for(const count of [1,2,3,4]){
const q=pricing.quoteMediaCredits({kind:'image',providerId,size,quality:'medium',count,performanceMode});
const resolution=providerId==='image-6'?'medium:'+size:size;
const {rows}=await db.query('select public.reserve_ai_mode_media_credits($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',['00000000-0000-4000-8000-000000000001','image',providerId,'00000000-0000-4000-8000-000000000002',resolution,null,q.totalCredits,count,performanceMode]);
assert.equal(rows[0].result.credits,q.totalCredits,JSON.stringify({providerId,size,count,performanceMode}));assert.equal(rows[0].result.ok,true);cases++;
}console.log('Mode SQL parity passed: '+cases+' image combinations');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
