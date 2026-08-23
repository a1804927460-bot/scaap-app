'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  sanitizePublicModelLabel,
  sanitizePublicAiError
} = require('../lib/public-model-label');
const { neutralProviderName, normalizeGatewayCatalog } = require('../lib/gateway-catalog');
const { PROVIDER_CATALOG_VERSION } = require('../lib/provider-catalog');

assert.equal(sanitizePublicModelLabel('GPT Image 2 (Atlas Cloud)'), 'GPT Image 2');
assert.equal(sanitizePublicModelLabel('Seedance 2.5 · QuickRouter'), 'Seedance 2.5');
assert.equal(sanitizePublicModelLabel('Nano Banana Pro'), 'Nano Banana Pro');
assert.equal(sanitizePublicModelLabel('MiniMax H3'), 'MiniMax H3');
assert.equal(sanitizePublicModelLabel('Gemini 3.7 Flash'), 'Gemini 3.7 Flash');
assert.doesNotMatch(sanitizePublicAiError('The 302 tool service rejected this request.'), /302/i);
assert.doesNotMatch(sanitizePublicAiError('QuickRouter Gemini API rejected HTTP 502.'), /quickrouter|gemini|502/i);
assert.equal(neutralProviderName('GPT Image 2 (Atlas Cloud)'), 'GPT Image 2');

const catalog = normalizeGatewayCatalog({
  catalogVersion: PROVIDER_CATALOG_VERSION,
  providers: [{ id: 'image-1', kind: 'image', name: 'QuickRouter image model' }]
}, 'https://gateway.example');
assert.equal(catalog.providers[0].name, 'Nano Banana Pro');

const rendererSource = fs.readFileSync(path.resolve(__dirname, '../src/js/public-model-label.js'), 'utf8');
const renderer = { window: null };
renderer.window = renderer;
vm.createContext(renderer);
vm.runInContext(rendererSource, renderer);
assert.equal(renderer.publicModelLabel('GPT Image 2 (Atlas Cloud)'), 'GPT Image 2');
assert.doesNotMatch(renderer.publicAiErrorMessage('Atlas Cloud returned an API error.'), /atlas/i);

const indexSource = fs.readFileSync(path.resolve(__dirname, '../src/index.html'), 'utf8');
assert.ok(indexSource.indexOf('js/public-model-label.js') < indexSource.indexOf('js/store-client.js'));

const mainSource = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
assert.doesNotMatch(mainSource, /Atlas Cloud reference audio/i);
const usageSource = fs.readFileSync(path.resolve(__dirname, '../src/js/usage-settings.js'), 'utf8');
assert.match(usageSource, /publicModelLabel\(label,/);

console.log('Public AI label tests passed.');
