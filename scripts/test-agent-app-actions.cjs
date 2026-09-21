'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {appCapabilityInstruction}=require('../lib/agent-app-capabilities');
function setup(overrides={}) {
 const calls=[];
 const el=()=>({children:[],append(...nodes){this.children.push(...nodes);},setAttribute(){}});
 const api={getCloudSession:async()=>({user:{id:'a'}}),getAiMediaConfig:async()=>({imageProviders:[{id:'image-2',name:'Nano Banana 2',hasApiKey:true,capabilities:{sizes:['1K']}}]}),quoteMediaCredits:async()=>({totalCredits:7}),generateAiMedia:async request=>{calls.push(request);return {ok:true,files:[{id:'f',name:'burger.png',url:'messs://file'}]};},...overrides};
 const context={document:{createElement:el},window:{messsAPI:api,MesssWorkHub:{open:page=>calls.push(page)}},AppState:{files:[]},confirmAiMediaDeliveries:async files=>{calls.push('confirmed');return files;},selectFileForPreview:()=>{}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../src/js/agent-message-format.js'),'utf8'),context);
 return {context,calls,card:()=>context.createAgentAppAction('messs-image',JSON.stringify({providerId:'image-2',prompt:'A burger photo'}))};
}
test('capability registry exposes configured names but no endpoints or credentials',()=>{
 const text=appCapabilityInstruction({imageProviders:[{id:'image-2',name:'Nano Banana 2',hasApiKey:true,apiKey:'SECRET',endpoint:'SECRET_URL'},{id:'hidden',name:'hidden',hidden:true,hasApiKey:true}]});
 assert.match(text,/Nano Banana 2/);assert.doesNotMatch(text,/SECRET|hidden/);
 assert.match(text,/messs-question/);assert.match(text,/questionId/);
});

test('question protocol is shared by chat and canvas renderers',()=>{
 const format=fs.readFileSync(require.resolve('../src/js/agent-message-format.js'),'utf8');
 assert.match(format,/createAgentQuestionCard/); assert.match(format,/MesssAgentQuestionAnswer/);
 for(const file of ['ai-assistant.js','canvas-workspace.js']) assert.match(fs.readFileSync(require.resolve('../src/js/'+file),'utf8'),/renderAgentMessageContent/);
 assert.match(fs.readFileSync(require.resolve('../src/styles/agent-interface.css'),'utf8'),/agent-question-card/);
});
test('shared action quotes before generation and prevents double submission',async()=>{
 const {card,calls}=setup();const c=card(),button=c.children[3];
 await button.onclick();assert.equal(calls.length,0);assert.equal(button.textContent,'确认生成');
 await button.onclick();assert.equal(calls[0].imageProviderId,'image-2');assert.equal(calls[0].placeOnBoard,false);assert.equal(calls[1],'confirmed');
 await button.onclick();assert.equal(calls.length,2);assert.equal(button.disabled,true);
});
test('unavailable model or unknown pricing cannot generate',async()=>{
 for(const overrides of [{getAiMediaConfig:async()=>({imageProviders:[]})},{quoteMediaCredits:async()=>({})}]){
 const {card,calls}=setup(overrides);const c=card();await c.children[3].onclick();assert.equal(calls.length,0);assert.notEqual(c.children[3].textContent,'确认生成');
 }
});
test('account change invalidates a prepared paid action',async()=>{
 let owner='a';const {card,calls}=setup({getCloudSession:async()=>({user:{id:owner}})});const c=card();await c.children[3].onclick();owner='b';await c.children[3].onclick();assert.equal(calls.length,0);assert.match(c.children[2].textContent,/账号已切换/);
});
test('restored action only renders and validates allowed navigation',()=>{
 const {context,calls,card}=setup();card();assert.equal(calls.length,0);
 assert.equal(context.createAgentAppAction('messs-open','{"page":"__proto__"}'),null);
 context.createAgentAppAction('messs-open','{"page":"skills"}').onclick();assert.deepEqual(calls,['skills']);
 for(const file of ['ai-assistant.js','canvas-workspace.js']) assert.match(fs.readFileSync(require.resolve('../src/js/'+file),'utf8'),/renderAgentMessageContent/);
});
