'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/js/model-badges.js'), 'utf8');
assert.ok(fs.existsSync(path.resolve(__dirname, '../src/assets/model-icons/doubao-seedream.ico')), 'Seedream badge asset is missing.');
assert.match(source, /model-icons\/doubao-seedream\.ico/, 'Seedream badge must use the bundled Doubao icon.');
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

assert.equal(context.aiModelBadgeKind({ id: 'image-1', name: 'Nano Banana Pro' }), 'banana-pro');
assert.equal(context.aiModelBadgeKind({ id: 'dynamic', name: 'GPT Image 2' }), 'gpt');
assert.equal(context.aiModelBadgeKind({ id: 'chat-1::gpt-5', name: 'gpt-5' }), 'gpt');
assert.equal(context.aiModelBadgeKind({ id: 'image-2', name: 'Nanobanana Pro SE' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'image-5', name: 'Nano banana2' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'image-3', name: 'Seedream 5.0 Lite' }), 'seedream');
assert.equal(context.aiModelBadgeKind({ id: 'custom', model: 'doubao-seedream-5-0-260128' }), 'seedream');
assert.equal(context.aiModelBadgeKind({ id: 'video-1', name: 'MiniMax H3' }), null);

console.log('Model badge tests passed.');
