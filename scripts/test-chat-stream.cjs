'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { requestChat } = require('../lib/ai-chat-provider');
const { AiGatewayClient } = require('../lib/ai-gateway-client');
const { readChatCompletionStream, readGatewayChatStream, createChatPreview } = require('../lib/chat-stream');

const sse = data => `data: ${JSON.stringify(data)}\r\n\r\n`;
const delta = (text, finish = null) => sse({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] });
const config = { apiKey: 'test', chatEndpoint: 'https://example.test/v1/chat/completions', chatModel: 'test', returnUsage: true };
function response(text, split = 13) {
  const bytes = Buffer.from(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.subarray(i, i + split));
      controller.close();
    }
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('OpenAI SSE handles split UTF-8, usage-only events and completion', async () => {
  const parts = [];
  const payload = await readChatCompletionStream(response(': ping\r\n\r\n' + delta('\u4f60\u597d') + delta(' world', 'stop')
    + sse({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } }) + 'data: [DONE]\r\n\r\n', 1), text => parts.push(text));
  assert.equal(payload.choices[0].message.content, '\u4f60\u597d world');
  assert.equal(parts.join(''), '\u4f60\u597d world');
  assert.equal(payload.usage.total_tokens, 12);
});

test('streamed truncation retains existing exact-overlap continuation and usage', async () => {
  let calls = 0;
  const previews = [];
  const result = await requestChat(async (_url, options) => {
    const body = JSON.parse(options.body);
    calls++;
    if (calls === 1) {
      assert.equal(body.stream, true);
      return response(delta('start', 'length') + sse({ usage: { prompt_tokens: 2, completion_tokens: 3 } }) + 'data: [DONE]\n\n');
    }
    assert.equal(body.stream, false);
    return Response.json({ choices: [{ message: { content: 'start end' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
  }, { ...config, onDelta: value => previews.push(value) }, { prompt: 'test' });
  assert.equal(result.text, 'start end');
  assert.equal(result.usage.totalTokens, 12);
  assert.deepEqual(previews, ['start']);
  assert.equal(calls, 2);
});

test('JSON-only upstream compatibility never resubmits', async () => {
  let calls = 0;
  const result = await requestChat(async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: 'legacy' } }] });
  }, { ...config, onDelta: () => assert.fail('JSON is not a fake stream') }, { prompt: 'test' });
  assert.equal(result.text, 'legacy');
  assert.equal(calls, 1);
});

test('broken, malformed, oversized and policy-filtered streams never succeed or replay', async () => {
  const { safeRouteFallback } = await import('../gateway/src/route-resilience.js');
  for (const data of [delta('partial'), delta('partial') + 'data: nope\n\n',
    delta('partial') + sse({ error: { message: 'busy' } }), delta('partial', 'content_filter'),
    delta('a'.repeat(100001))]) {
    await assert.rejects(readChatCompletionStream(response(data), () => {}), error => {
      assert.equal(error.providerTaskAccepted, true);
      assert.equal(safeRouteFallback(error), false);
      return true;
    });
  }
});

test('cancellation closes the response reader', async () => {
  let canceled = false;
  const controller = new AbortController();
  const stream = new Response(new ReadableStream({ cancel() { canceled = true; } }));
  const pending = readChatCompletionStream(stream, () => {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(canceled, true);
});

test('gateway requires a terminal event and does not expose upstream errors', async () => {
  await assert.rejects(readGatewayChatStream(response('event: delta\ndata: {"text":"partial"}\n\n'), () => {}));
  await assert.rejects(readGatewayChatStream(response('event: error\ndata: {"code":"chat-service-busy","status":503,"message":"secret"}\n\n'), () => {}), error => {
    assert.equal(error.code, 'chat-service-busy');
    assert.equal(error.status, 503);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
});

test('preview withholds all split internal artifact/tool bodies', () => {
  for (const tag of ['messs-tool', 'messs-file', 'messs-work']) {
    const visible = [];
    const preview = createChatPreview(value => visible.push(value));
    for (const character of `Working. <${tag}>SECRET</${tag}>done`) preview(character);
    assert.equal(visible.at(-1), 'Working. ');
    assert.ok(visible.every(text => !text.includes('SECRET') && !text.includes('<')));
  }
});

test('real HTTP gateway delivers upstream delta before completion, preserves usage, supports old clients', async () => {
  const { openChatStream } = await import('../gateway/src/chat-stream.js');
  let release, firstDelta, requests = 0;
  const hold = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { firstDelta = resolve; });
  const server = http.createServer(async (req, res) => {
    requests++;
    if (req.headers.accept !== 'text/event-stream') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ text: 'legacy' }));
    }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const writer = openChatStream(res, controller.signal);
    try {
      const result = await requestChat(async () => new Response(new ReadableStream({ async start(c) {
        c.enqueue(Buffer.from(delta('first')));
        await hold;
        c.enqueue(Buffer.from(delta(' last', 'stop') + sse({ usage: { prompt_tokens: 1, completion_tokens: 2 } }) + 'data: [DONE]\n\n'));
        c.close();
      } }), { headers: { 'Content-Type': 'text/event-stream' } }),
      { ...config, onDelta: text => writer.send('delta', { text }) }, { prompt: 'test' }, controller.signal);
      await writer.send('done', result);
    } finally { writer.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new AiGatewayClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, fetchImpl: fetch, getAccessToken: async () => 'test' });
  try {
    let completed = false;
    const parts = [];
    const pending = client.chat({ prompt: 'test', returnUsage: true }, AbortSignal.timeout(5000), text => { parts.push(text); firstDelta(); });
    pending.then(() => { completed = true; });
    await seen;
    assert.equal(completed, false);
    assert.deepEqual(parts, ['first']);
    release();
    const result = await pending;
    assert.equal(result.text, 'first last');
    assert.equal(result.usage.totalTokens, 3);
    assert.equal(await client.chat({ prompt: 'test' }), 'legacy');
    assert.equal(requests, 2);
  } finally {
    release();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
