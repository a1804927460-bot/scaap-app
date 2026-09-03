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
  { id: 'chat-1', name: 'Messs AI', endpoint: 'https://primary.test', models: ['gemini-3.7-flash'] },
  { id: 'chat-2', name: 'Backup', endpoint: 'https://backup.test', models: ['gemini-3.7-flash', 'kimi-k3'] },
  { id: 'chat-3', name: 'Sol', endpoint: 'https://sol.test', models: ['gpt-5.6-sol'] }
];
const chat = options.chatOptions(providers, {
  allowedModels: new Set(['gemini-3.7-flash', 'kimi-k3', 'gpt-5.6-sol']),
  activeProviderId: 'chat-2'
});
assert.equal(JSON.stringify(chat.map((entry) => entry.model)), JSON.stringify([
  'gemini-3.7-flash', 'kimi-k3', 'gpt-5.6-sol'
]));
assert.equal(chat.find((entry) => entry.model === 'gemini-3.7-flash').providerId, 'chat-2');
assert.equal(options.uniqueProviders([
  { id: 'image-1', name: 'Nano Banana Pro', endpoint: 'https://one.test' },
  { id: 'legacy', name: 'Nano Banana Pro legacy route', endpoint: 'https://two.test' }
], 'image').length, 1);
assert.equal(options.uniqueProviders([
  { id: 'image-1', name: 'Nano Banana Pro', endpoint: 'https://one.test', logicalModel: 'nano-banana-pro' },
  { id: 'image-1-backup', name: 'Nano Banana Pro backup', endpoint: 'https://two.test', logicalModel: 'nano-banana-pro' }
], 'image', { activeProviderId: 'image-1-backup' })[0].id, 'image-1-backup');
process.stdout.write('AI provider option tests passed.\n');
