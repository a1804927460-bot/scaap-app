const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const optimizer = require('../lib/prompt-optimizer');
const brand = require('../src/js/agent-brand-policy');

(async () => {
  const text = '把图1放到图2左上角，不要改变颜色';
  const request = optimizer.buildOptimizationRequest({ source: text, mode: 'expand' });
  assert.equal(request.source, text);
  assert.equal(request.messages.length, 2);
  assert.equal(brand.replyForRequest(request.messages[0].content), null);
  assert.throws(() => optimizer.validateOptimizationResult(brand.reply('中文')));
  assert.equal(optimizer.validateOptimizationResult(text), text);
  const main = fs.readFileSync('main.js', 'utf8');
  const resolverSource = main.slice(main.indexOf('async function requireGatewayChatProvider('), main.indexOf('\nfunction assertAiTransportReady('));
  const catalog = { compatible: true, providers: [{ id: 'chat-test', kind: 'chat', models: ['test-model'] }] };
  const resolveProvider = vm.runInNewContext(resolverSource + '; requireGatewayChatProvider', {
    getVerifiedGatewayCatalog: async () => catalog,
    assertGatewayProvider: require('../lib/gateway-catalog').assertGatewayProvider
  });
  assert.equal((await resolveProvider('', '')).id, 'chat-test', 'Optimizer must resolve a default rather than reject its empty provider ID');
  assert.equal((await resolveProvider('', 'test-model')).id, 'chat-test');
  await assert.rejects(resolveProvider('missing-provider', ''), { code: 'provider-not-configured' });
  const handler = main.split("ipcMain.handle('ai:optimizePrompt', ")[1].split("\n  ipcMain.handle('ai:chat'")[0];
  let captured, settle = [], calls = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  vm.runInNewContext('ipcMain.handle("test", ' + handler, {
    ipcMain: { handle: (_, fn) => { captured = fn; } },
    require: createRequire(path.resolve('main.js')),
    assertPromptHasNoSecrets: require('../lib/privacy-guard').assertPromptHasNoSecrets,
    membershipService: {
      beginUsage: () => ({ ok: true, usageId: 'optimization' }),
      finishUsage: (...args) => settle.push(args)
    },
    aiWorkspaceOwner: () => 'owner',
    runtimeConfig: { gatewayConfigured: true },
    generateAiChatReply: async (...args) => { calls.push(args); await pending; return text; }
  });
  const first = captured({}, { source: text });
  const second = captured({}, { source: '一个海边场景' });
  assert.equal(calls.length, 2, 'Independent optimizations must not wait on a shared busy lock');
  assert.equal(calls[0][1].length, 2, 'No Agent history may enter optimization');
  assert.equal(calls[0][0], text, 'Only user text goes through request intent checks');
  release();
  assert.equal((await first).text, text);
  assert.equal((await second).ok, true);
  assert.equal(settle.length, 2);
  console.log('Prompt optimization: independent requests, clean context, result validation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
