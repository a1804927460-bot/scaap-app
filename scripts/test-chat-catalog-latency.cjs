'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const source=fs.readFileSync(require.resolve('../main.js'),'utf8');
 let owner='a',calls=0,release;
 const context={gatewayCatalogCache:null,supabaseAuth:{getPublicSession:()=>({user:{id:owner}})},runtimeConfig:{aiGatewayUrl:'https://example.test'},normalizeGatewayCatalog:x=>x,aiGateway:{getConfig:()=>{calls++;return new Promise(resolve=>release=resolve)}},Date};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let gatewayCatalogPending = null;'),source.indexOf('async function requireGatewayProvider(')),context);
 const requests=Array.from({length:10},()=>context.getVerifiedGatewayCatalog());
 assert.equal(calls,1);release({providers:[]});await Promise.all(requests);
 await context.getVerifiedGatewayCatalog();assert.equal(calls,1);
 owner='b';const stale=context.getVerifiedGatewayCatalog();owner='c';release({providers:[]});await assert.rejects(stale,/Account changed/);
 const retry=context.getVerifiedGatewayCatalog();release({providers:[]});await retry;assert.equal(calls,3);
 console.log('PASS: ten concurrent catalog requests use one network call; cache reuse, account isolation and retry verified.');
})().catch(e=>{console.error(e);process.exitCode=1});
