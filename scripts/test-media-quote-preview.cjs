'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMediaQuotePreview}=require('../lib/media-quote-preview');
test('slow quote returns local estimate, merges duplicates and caches verified result',async()=>{
 let calls=0,finish;const remote=new Promise(resolve=>{finish=resolve});
 const preview=createMediaQuotePreview({localQuote:()=>({totalCredits:12}),remoteQuote:()=>{calls++;return remote},scope:()=> 'a',waitMs:5});
 const results=await Promise.all([preview({size:'1K'}),preview({size:'1K'})]);
 assert.equal(calls,1);assert.deepEqual(results,[{totalCredits:12,authoritative:false,quoteSource:'local'},{totalCredits:12,authoritative:false,quoteSource:'local'}]);
 finish({totalCredits:15});await new Promise(resolve=>setImmediate(resolve));
 const cached=await preview({size:'1K'});assert.equal(cached.totalCredits,15);cached.totalCredits=0;
 assert.equal((await preview({size:'1K'})).totalCredits,15);assert.equal(calls,1);
});
test('account, parameters and expiry isolate estimates',async()=>{
 let owner='a',clock=0,calls=0;
 const preview=createMediaQuotePreview({localQuote:()=>({totalCredits:1}),remoteQuote:async()=>({totalCredits:++calls}),scope:()=>owner,now:()=>clock,ttlMs:10});
 await preview({size:'1K',count:1});await preview({count:1,size:'1K'});assert.equal(calls,1);
 owner='b';await preview({size:'1K',count:1});assert.equal(calls,2);
 await preview({size:'2K',count:1});assert.equal(calls,3);
 clock=11;await preview({size:'2K',count:1});assert.equal(calls,4);
});
test('failed requests are not cached and local validation is preserved',async()=>{
 let calls=0;const preview=createMediaQuotePreview({localQuote:r=>{if(r.bad)throw Error('invalid');return {totalCredits:8}},remoteQuote:async()=>{calls++;throw Error('offline')},scope:()=> 'a'});
 assert.equal((await preview({})).totalCredits,8);await preview({});assert.equal(calls,2);await assert.rejects(preview({bad:true}),/invalid/);
});
