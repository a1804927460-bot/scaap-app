'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/js/model-badges.js'), 'utf8');
const sidebar = fs.readFileSync(path.resolve(__dirname, '../src/js/sidebar.js'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

assert.equal(context.aiModelBadgeKind({ id: 'image-1', name: 'Nano Banana Pro' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'dynamic', name: 'GPT Image 2' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'chat-1::gpt-5', name: 'gpt-5' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'image-2', name: 'Nano Banana 2' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'image-5', name: 'Nano Banana 2 Lite' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'image-3', name: 'Chaser Pro', icon: 'chaser-pro' }), null);
assert.doesNotMatch(source, /assets\/model-icons\//);
assert.equal(context.aiModelBadgeKind({ id: 'custom', model: 'doubao-seedream-5-0-260128' }), null);
assert.equal(context.aiModelBadgeKind({ id: 'video-1', name: 'MiniMax H3' }), null);
assert.match(sidebar, /isModelFile\(file\)[\s\S]*fallback\.textContent = '3D'/);
assert.match(sidebar, /file-thumbnail-model-badge/);

console.log('Model badge tests passed.');
require('./test-public-model-label');
