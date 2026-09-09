const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {KLING_VARIANTS}=require('../lib/kling-options');
const {quoteMediaCredits}=require('../lib/credit-pricing');
const extract=(source,name)=>{
  const start=source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start>=0);const end=source.indexOf('$$;',source.indexOf('as $$',start));
  assert.ok(end>start);return source.slice(start,end+3);
};
(async()=>{
  const db=new PGlite();let cases=0;
  try {
    const base=fs.readFileSync('supabase/migrations/202609090001_economy_media_pricing.sql','utf8');
    const migration=fs.readFileSync('supabase/migrations/202609090002_atlas_kling_pricing.sql','utf8');
    await db.exec(extract(base,'quote_media_retail_credits_from_cny'));
    await db.exec(extract(migration,'quote_ai_video_retail_credits'));
    for(const [serviceTier,v] of Object.entries(KLING_VARIANTS)) for(const resolution of Object.keys(v.rates)) for(const duration of v.durations) for(const generateAudio of v.sound?[false,true]:[false]) {
      const local=quoteMediaCredits({kind:'video',providerId:'video-14',serviceTier,resolution,duration,generateAudio});
      const sql=await db.query('select public.quote_ai_video_retail_credits($1,$2,$3) as credits',[local.providerId,resolution,duration]);
      assert.equal(sql.rows[0].credits,local.totalCredits,JSON.stringify({serviceTier,resolution,duration,generateAudio}));cases++;
    }
    for(const [id,res,seconds] of [['atlas-kling-standard-silent','4K',5],['atlas-kling-turbo-audio','720P',5],['atlas-kling-pro-audio','1080P',6]]) {
      const q=await db.query('select public.quote_ai_video_retail_credits($1,$2,$3) as credits',[id,res,seconds]);
      assert.equal(q.rows[0].credits,null);
    }
    console.log(`Kling SQL and desktop pricing match for ${cases} supported combinations; unsupported contracts rejected.`);
  } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
