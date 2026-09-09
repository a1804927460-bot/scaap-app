const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {quoteMediaCredits}=require('../lib/credit-pricing');
const extract=(s,name)=>{const start=s.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0);const body=s.indexOf('as $',start);assert.ok(body>start);const end=s.indexOf('$;',body);assert.ok(end>body);return s.slice(start,end+3);};
(async()=>{const db=new PGlite();try {
  const base=fs.readFileSync('supabase/migrations/202609090001_economy_media_pricing.sql','utf8');
  const migration=fs.readFileSync('supabase/migrations/202609090003_legnext_midjourney82.sql','utf8');
  await db.exec(extract(base,'quote_media_retail_credits_from_cny'));
  await db.exec(extract(migration,'quote_ai_image_unit_credits'));
  await db.exec(`create function public.reserve_priced_ai_credits_internal(uuid,text,text,uuid,text,integer,integer,integer) returns jsonb language sql as $$ select jsonb_build_object('credits',$8,'expected',$7) $$;`);
  await db.exec(extract(migration,'reserve_legnext_credits'));
  for(const size of ['1K','2K']) {
    const expected=quoteMediaCredits({kind:'image',providerId:'image-18',size}).totalCredits;
    const q=await db.query('select public.quote_ai_image_unit_credits($1,$2) as credits',['image-18',size]);assert.equal(q.rows[0].credits,expected);
    const r=await db.query("select public.reserve_legnext_credits(null,'image','image-18',null,$1,null,$2) as result",[size,expected]);assert.deepEqual(r.rows[0].result,{credits:expected,expected});
  }
  assert.equal((await db.query("select public.quote_ai_image_unit_credits('image-18','4k') as n")).rows[0].n,null);
  const r=await db.query("select public.reserve_legnext_credits(null,'image','image-18',null,'4k') as r");assert.equal(r.rows[0].r.ok,false);
  console.log('Legnext SQL quote and legacy reservation match desktop; unsupported 4K rejected.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
