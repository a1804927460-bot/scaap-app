const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('main.js','utf8');
const start=source.indexOf('async function quoteMediaCreditsForAccount('),end=source.indexOf('\nasync function fileToAiChatAttachment',start);
const context={quoteMediaCredits:()=>({totalCredits:50,unitCredits:50}),hasAuthenticatedGatewaySession:()=>true,aiGateway:{isConfigured:()=>true,quoteMediaCredits:async()=>({totalCredits:19,unitCredits:19,pricingVersion:'server-new'})}};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
(async()=>{
 const current=await context.quoteMediaCreditsForAccount({});assert.equal(current.totalCredits,19);assert.equal(current.authoritative,true);
 context.aiGateway.quoteMediaCredits=async()=>{throw Error('offline')};const fallback=await context.quoteMediaCreditsForAccount({});assert.equal(fallback.totalCredits,50);assert.equal(fallback.authoritative,false);
 const a=source.indexOf('function butlerOutputAccounting('),b=source.indexOf('\nasync function addButlerOutputFile',a);vm.runInContext(source.slice(a,b),context);
 assert.equal(context.butlerOutputAccounting({},19).creditsCharged,undefined);
 assert.equal(context.butlerOutputAccounting({creditsCharged:null},19).creditsCharged,undefined);
 assert.equal(context.butlerOutputAccounting({creditsCharged:.14},19).creditsCharged,.14);
 assert.equal(context.butlerOutputAccounting({deliveryPending:true,creditsCharged:19},19).creditsCharged,undefined);
 console.log('Gateway quote wins across pricing versions; offline previews and unconfirmed tool charges never become receipts.');
})().catch(e=>{console.error(e);process.exitCode=1;});
