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
