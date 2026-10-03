'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { AiGatewayClient } = require('../lib/ai-gateway-client');

const image = 'data:image/png;base64,aGVsbG8=';
const token = 'existing-task-token-123456';

async function testDurableTool(method) {
  const calls = [];
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example',
    getAccessToken: async () => 'test',
    fetchImpl: async (_url, options) => {
      calls.push({ id: options.headers['X-Idempotency-Key'], body: options.body });
      // Longer than the former three-attempt limit; no new paid operation.
      if (calls.length <= 3) throw new TypeError('fetch failed');
      return new Response(Buffer.from('saved-result'), { status: 200 });
    }
  });
  assert.equal((await client[method](image)).toString(), 'saved-result');
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(call => call.id)).size, 1);
  assert.equal(new Set(calls.map(call => call.body)).size, 1);
  assert.match(calls[0].id, /^[a-f0-9-]{36}$/);
  calls.length = 0;
  client.fetch = async () => {
    calls.push({});
    return new Response(JSON.stringify({code:'insufficient-credits'}), {status:402});
  };
  await assert.rejects(() => client[method](image), error => error.status === 402);
  assert.equal(calls.length, 1);
}

async function testStatus(method, args) {
  const bodies = [];
  const client = new AiGatewayClient({
    baseUrl:'https://gateway.example', getAccessToken:async () => 'test',
    fetchImpl:async (_url, options) => {
      bodies.push(options.body);
      return bodies.length === 1
        ? new Response(JSON.stringify({code:'gateway-error'}), {status:503})
        : new Response(JSON.stringify({status:'succeeded'}), {status:200});
    }
  });
  assert.equal((await client[method](...args)).status, 'succeeded');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
}

const source = fs.readFileSync(require('node:path').join(__dirname, '../src/js/board-media-meta.js'), 'utf8');
const predicate = source.slice(source.indexOf('function isTransientBoardButlerStatusFailure'), source.indexOf('function boardButlerPollDelay'));
const retryable = vm.runInNewContext(predicate + '\nisTransientBoardButlerStatusFailure');
for (const status of [429, 500, 502, 503, 504]) {
  assert.equal(retryable({httpStatus:status, reason:'gateway-error'}), true);
}
for (const status of [400, 401, 402, 403, 404]) {
  assert.equal(retryable({httpStatus:status, reason:'gateway-request-failed'}), false);
}

Promise.all([
  ...['removeBackground','expandImage','upscaleImage'].map(testDurableTool),
  testStatus('get3dStatus', [token]),
  testStatus('getImageToolStatus', [token, 'seededit-v3'])
]).then(() => console.log('Butler recovery tests passed.')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
