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
assert.equal(sanitizePublicModelLabel('Gemini 3.1 Pro'), 'Gemini 3.1 Pro');
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
assert.equal(renderer.publicModelLabel('GPT Image 2 (Atlas Cloud)'), 'Mess Image2');
assert.equal(renderer.publicModelLabel('Nano Banana Pro'), 'Mess NPro');
assert.equal(renderer.publicModelLabel('Nano Banana 2'), 'Mess N2');
assert.equal(renderer.publicModelLabel('GPT Image 2.5'), 'Mess Image2.5');
assert.equal(renderer.publicModelLabel('Midjourney V8.2'), 'Mess Jennie');
assert.doesNotMatch(renderer.publicAiErrorMessage('Atlas Cloud returned an API error.'), /atlas/i);
renderer.document = { documentElement: { dataset: { language: 'zh' } } };
assert.equal(
  renderer.publicAiErrorMessage('The selected video model does not support this aspect ratio with reference images.'),
  '当前生成模式不支持这个画面比例，已自动切换为可用比例，请重试。'
);

const indexSource = fs.readFileSync(path.resolve(__dirname, '../src/index.html'), 'utf8');
const rejected = 'The generation request was not accepted. Check the reference files and settings, then try again.';
const localizedRejection = '\u751f\u6210\u8bf7\u6c42\u672a\u88ab\u63a5\u53d7\uff0c\u8bf7\u68c0\u67e5\u53c2\u8003\u7d20\u6750\u548c\u53c2\u6570\u540e\u91cd\u8bd5\u3002';
assert.equal(renderer.publicAiErrorMessage(rejected), localizedRejection);
assert.equal(renderer.publicAiErrorMessage('', 'fallback', 'provider-request-failed'), localizedRejection);
assert.equal(renderer.publicAiErrorMessage(rejected + ' No points were charged.'), localizedRejection + '\u672c\u6b21\u672a\u6263\u79ef\u5206\u3002');
renderer.document.documentElement.dataset.language = 'en';
assert.equal(renderer.publicAiErrorMessage(rejected), rejected);
renderer.document.documentElement.dataset.language = 'ja';
assert.doesNotMatch(renderer.publicAiErrorMessage(rejected), /generation request/);
renderer.document.documentElement.dataset.language = 'zh';
const boardSource = fs.readFileSync(path.resolve(__dirname, '../src/js/board-media-meta.js'), 'utf8');
vm.runInContext(boardSource.slice(boardSource.indexOf('function boardButlerError('), boardSource.indexOf('function isTransientBoardButlerStatusFailure(')), renderer);
const failure = renderer.boardButlerError({ reason: 'provider-request-failed', message: rejected, httpStatus: 400, requestId: 'test-request', retryAfterMs: 1200 }, 'fallback');
assert.equal(failure.message, localizedRejection);
assert.equal(failure.reason, 'provider-request-failed');
assert.equal(failure.status, 400);
assert.equal(failure.requestId, 'test-request');
assert.equal(failure.retryAfterMs, 1200);
assert.ok(indexSource.indexOf('js/public-model-label.js') < indexSource.indexOf('js/store-client.js'));

const mainSource = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
assert.doesNotMatch(mainSource, /Atlas Cloud reference audio/i);
const usageSource = fs.readFileSync(path.resolve(__dirname, '../src/js/usage-settings.js'), 'utf8');
assert.match(usageSource, /publicModelLabel\(label,/);

console.log('Public AI label tests passed.');
