'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { createChatPreview } = require('../lib/chat-stream');
const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
const source = main.slice(main.indexOf('async function generateAiChatReply('), main.indexOf('function sanitizeAiErrorText('));

function runtime(chat) {
  const timers = new Set();
  const logs = [];
  const scope = vm.createContext({
    AbortController, Date,
    setTimeout(fn, delay) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    console: { info: (...args) => logs.push(args) },
    require: () => ({ createChatPreview }),
    assertAiTransportReady: () => 'gateway',
    requireGatewayChatProvider: async () => ({ id: 'test', models: ['model'] }),
    aiGateway: { chat },
    localizedMessage: en => en
  });
  vm.runInContext(source, scope);
  return { call: onPreview => scope.generateAiChatReply('test', [], 'test', 'model', 'fast', onPreview), timers, logs };
}

test('Electron forwarding publishes early, coalesces token bursts, hides artifact bodies and disposes timers', async () => {
  let release, first;
  const held = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { first = resolve; });
  const previews = [];
  const app = runtime(async (_request, _signal, onDelta) => {
    onDelta('Hello');
    for (let i = 0; i < 1000; i++) onDelta('!');
    onDelta('<mes');onDelta('ss-file>SECRET</messs-file>');
    await held;
    return 'final validated text';
  });
  const pending = app.call(text => { previews.push(text); first(); });
  try {
    await seen;
    assert.equal(previews[0], 'Hello');
    assert.equal(previews.length, 1, 'No per-token IPC flood');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(previews.length, 2);
    assert.equal(previews[1].length, 1005);
    assert.ok(previews.every(text => !text.includes('SECRET')));
    release();
    assert.equal(await pending, 'final validated text');
    assert.equal(app.timers.size, 0);
    const count = previews.length;
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(previews.length, count);
    assert.equal(app.logs.length, 1);
  } finally { release(); }
});

test('Electron retains JSON compatibility and disposes streaming timers after failure', async () => {
  const legacy = runtime(async () => 'legacy');
  assert.equal(await legacy.call(() => assert.fail('No fake typewriter')), 'legacy');
  assert.equal(legacy.timers.size, 0);
  const previews = [];
  const failed = runtime(async (_request, _signal, onDelta) => {
    onDelta('partial');onDelta(' text');
    throw Object.assign(new Error('interrupted'), { code: 'chat-stream-interrupted' });
  });
  await assert.rejects(failed.call(text => previews.push(text)), { code: 'chat-stream-interrupted' });
  assert.equal(failed.timers.size, 0);
  const count = previews.length;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(previews.length, count);
});
