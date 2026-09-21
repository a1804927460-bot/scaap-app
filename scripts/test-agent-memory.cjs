const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createLocalMemory} = require('../lib/agent-local-memory');
(async()=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'messs-memory-'));
  try {
    const a = createLocalMemory(root,'a'), b = createLocalMemory(root,'b');
    const first = await a.add('/reports/quarter.txt','\u7b2c\u4e00\u5b63\u5ea6\u8425\u6536\u589e\u957f 20 percent. Revenue report.');
    assert.equal((await a.search('Revenue'))[0].name,'quarter.txt');
    assert.ok((await a.search('\u8425\u6536')).length);
    assert.deepEqual(await b.search('Revenue'),[]);
    assert.equal((await createLocalMemory(root,'a').list()).length,1,'survives reload');
    await a.add('/reports/quarter.txt','Updated forecast');
    assert.equal((await a.list()).length,1,'updates do not duplicate');
    await Promise.all([a.add('/reports/two.txt','second'),a.add('/reports/three.txt','third')]);
    assert.equal((await a.list()).length,3,'concurrent writes do not lose documents');
    assert.deepEqual(await a.remove(first.id),{removed:true});
    assert.deepEqual(await a.search('forecast'),[]);
    assert.throws(()=>a.add('/secret.txt','-----BEGIN PRIVATE KEY-----'));
    console.log('Local memory passed: retrieval, Chinese segmentation, owner isolation, reload, updates, concurrent writes, deletion and secret rejection.');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});

// Shared conversation context policy: explicit preferences persist while old turns are bounded.
const { updateAgentMemory, buildAgentContextMessages } = require('../src/js/agent-context.js');
const memory = updateAgentMemory({ facts: [] }, [
  { role: 'user', content: '记住：默认使用中文，普通模式保持不变。' },
  { role: 'assistant', content: '好的。' },
  ...Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `临时消息 ${i}` }))
]);
assert.deepEqual(memory.facts, ['记住：默认使用中文，普通模式保持不变。']);
const compact = buildAgentContextMessages(
  Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `消息 ${i}` })),
  memory
);
assert.ok(compact.length <= 20, 'context window is bounded');
assert.match(compact.find(message => message.role === 'system')?.content || '', /默认使用中文/);
console.log('Agent context passed: explicit memory retention and bounded recent context.');
