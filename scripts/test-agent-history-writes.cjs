const assert = require('node:assert/strict');
const {createAgentHistoryWrites} = require('../lib/agent-history-writes');
const writes = createAgentHistoryWrites(), main = {}, detached = {};
const session = (id, second, text=id) => ({id,canvasId:id,updatedAt:`2026-09-22T00:00:0${second}Z`,messages:[{role:'assistant',content:text}]});
const a=session('a',0), b=session('b',0);
writes.read(main,'canvas',[a,b]);writes.read(detached,'canvas',[a,b]);
let stored=writes.save(main,'canvas',[a,b],[session('a',1,'new A'),b]);
stored=writes.save(detached,'canvas',stored,[a,session('b',2,'new B')]);
assert.equal(stored.find(s=>s.id==='a').messages[0].content,'new A');
assert.equal(stored.find(s=>s.id==='b').messages[0].content,'new B');
stored=writes.save(main,'canvas',stored,[session('a',1,'new A')]);
assert.ok(stored.some(s=>s.id==='b'),'A stale deletion must not delete an updated conversation');
writes.read(main,'canvas',stored);
stored=writes.save(main,'canvas',stored,stored.filter(s=>s.id!=='a'));
assert.ok(!stored.some(s=>s.id==='a'));
stored=writes.save(detached,'canvas',stored,[a,session('b',3,'latest B')]);
assert.ok(!stored.some(s=>s.id==='a'),'An unchanged stale snapshot must not resurrect deleted history');
assert.deepEqual(writes.save(main,'main',[],[session('main',1)]).map(s=>s.id),['main']);
// Exercise the actual durable sanitizers for generated-file restoration.
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('main.js','utf8');
const code=source.slice(source.indexOf('function sanitizeCanvasAgentHistory('),source.indexOf('function canvasUsageKind('));
const context=vm.createContext({MAX_CANVAS_AGENT_HISTORY_SESSIONS:100,MAX_CANVAS_AGENT_HISTORY_MESSAGES:100,MAX_AI_ASSISTANT_HISTORY_SESSIONS:100,MAX_AI_ASSISTANT_HISTORY_MESSAGES:100});
vm.runInContext(code,context);
for(const name of ['sanitizeCanvasAgentHistory','sanitizeAiAssistantHistory']) {
  const result=context[name]([{...a,messages:[{role:'assistant',content:'saved',creditsCharged:2,generatedFiles:[{token:'owner-file',name:'result.txt'}]}]}]);
  assert.equal(result[0].messages[0].generatedFiles[0].token,'owner-file');
  assert.equal(result[0].messages[0].creditsCharged,2);
}
console.log('PASS: concurrent window history, deletion conflicts, main/canvas separation and durable output-file restoration.');
