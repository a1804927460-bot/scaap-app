'use strict';
const assert = require('node:assert/strict');
const { materialize, parseWork } = require('../lib/ai-workspace');
const { parseAiArtifacts } = require('../lib/ai-attachments');
const { requestChat } = require('../lib/ai-chat-provider');
(async () => {
  assert.throws(() => parseWork('<messs-work>return {files:['), /截断/);
  assert.throws(() => parseAiArtifacts('<messs-file filename="a.obj">v 0 0 0'), /未完整/);
  assert.equal(parseWork('normal response'), null);
  for (const ext of ['obj', 'mtl', 'gltf', 'stl', 'rs', 'sql', 'toml', 'srt']) {
    const name = `file.${ext}`;
    const content = ext === 'obj' ? 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3' : 'text';
    assert.equal((await materialize({ files: [{ name, content }] }))[0].data.toString(), content);
    assert.equal(parseAiArtifacts(`<messs-file filename="${name}">${content}</messs-file>`).artifacts.length, 1);
  }
  const bytes = Buffer.from([0, 255, 1, 128, 42]);
  assert.deepEqual((await materialize({ files: [{ name: 'arbitrary.custom', base64: bytes.toString('base64') }] }))[0].data, bytes);
  await assert.rejects(materialize({ files: [{ name: 'fake.pptx', content: 'not a powerpoint' }] }));
  const payloads = [
    { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] },
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] },
    { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'partial' }
  ];
  for (const payload of payloads) {
    let calls = 0;
    const output = await requestChat(async () => {
      calls++; return { ok: true, status: 200, text: async () => JSON.stringify(calls === 1 ? payload : { choices: [{ finish_reason: 'stop', message: { content: 'partial complete' } }] }) };
    }, { apiKey: 'test', chatEndpoint: 'https://example.com/v1/chat/completions', chatModel: 'test' }, { prompt: 'generate file' });
    assert.equal(output, 'partial complete');
    assert.equal(calls, 2);
  }
  console.log('File integrity: text format parity, arbitrary binary bytes, partial tag rejection and four provider truncation signals passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
