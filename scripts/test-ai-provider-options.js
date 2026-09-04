'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-provider-options.js'), 'utf8');
const context = { globalThis: {}, console };
vm.runInNewContext(source, context);
const options = context.globalThis.MesssAiProviderOptions;
assert.ok(options);

const providers = [
  { id: 'chat-3', name: 'Gemini', endpoint: 'https://primary.test', models: ['gemini-3.1-pro'] },
  { id: 'chat-4', name: 'Sol', endpoint: 'https://sol.test', models: ['gpt-5.6-sol'] },
  { id: 'chat-5', name: 'Kimi', endpoint: 'https://kimi.test', models: ['kimi-k3'] }
];
const chat = options.chatOptions(providers, {
  allowedModels: new Set(['gemini-3.1-pro', 'kimi-k3', 'gpt-5.6-sol']),
  activeProviderId: 'chat-3'
});
assert.equal(JSON.stringify(chat.map((entry) => entry.model)), JSON.stringify([
  'gemini-3.1-pro', 'gpt-5.6-sol', 'kimi-k3'
]));
assert.equal(chat.find((entry) => entry.model === 'gemini-3.1-pro').providerId, 'chat-3');
assert.equal(options.uniqueProviders([
  { id: 'image-1', name: 'Nano Banana Pro', endpoint: 'https://one.test' },
  { id: 'legacy', name: 'Nano Banana Pro legacy route', endpoint: 'https://two.test' }
], 'image').length, 1);
assert.equal(options.uniqueProviders([
  { id: 'image-1', name: 'Nano Banana Pro', endpoint: 'https://one.test', logicalModel: 'nano-banana-pro' },
  { id: 'image-1-backup', name: 'Nano Banana Pro backup', endpoint: 'https://two.test', logicalModel: 'nano-banana-pro' }
], 'image', { activeProviderId: 'image-1-backup' })[0].id, 'image-1-backup');
process.stdout.write('AI provider option tests passed.\n');
