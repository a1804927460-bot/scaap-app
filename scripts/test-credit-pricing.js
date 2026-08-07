'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  POINTS_PER_CNY,
  quoteMediaCredits,
  publicCreditPricing
} = require('../lib/credit-pricing');

assert.strictEqual(POINTS_PER_CNY, 10);

assert.deepStrictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-1',
  count: 2
}), {
  kind: 'image',
  providerId: 'image-1',
  count: 2,
  units: 2,
  unit: 'image',
  unitCredits: 16,
  totalCredits: 32
});

assert.strictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-4',
  count: 99
}).totalCredits, 16, 'Image count must be capped at four.');

assert.deepStrictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-1',
  resolution: '2K',
  duration: 6
}), {
  kind: 'video',
  providerId: 'video-1',
  resolution: '2K',
  duration: 6,
  units: 6,
  unit: 'second',
  unitCredits: 16,
  totalCredits: 96
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: undefined
}).totalCredits, 60, 'Invalid duration must use the six-second default.');

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: 0
}).totalCredits, 40, 'Video billing must enforce the four-second minimum.');

const publicPricing = publicCreditPricing();
assert.strictEqual(publicPricing.image['image-5'], 8);
assert.strictEqual(publicPricing.video['video-1']['768P'], 10);

const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const boardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'main.css'), 'utf8');
assert.match(
  boardSource,
  /class="ai-credit-estimate"[\s\S]*?function updateCreditEstimate\(\)[\s\S]*?quoteMediaCredits[\s\S]*?totalCredits/,
  'The generation composer must display the authoritative media-credit quote.'
);
assert.match(
  boardSource,
  /kind,[\s\S]*?providerId: provider\.id,[\s\S]*?count: kind === 'image' \? count[\s\S]*?resolution: kind === 'video' \? size[\s\S]*?duration: kind === 'video' \? duration/,
  'Credit quotes must use the selected model, image count, video resolution and duration.'
);
assert.match(
  boardStyles,
  /\.ai-credit-estimate\s*\{[\s\S]*?white-space:\s*nowrap;/,
  'The composer credit estimate must remain legible beside the submit button.'
);
assert.match(
  indexHtml,
  /id="ai-assistant-credit-estimate"[\s\S]*?id="ai-assistant-submit"/,
  'The assistant must show its media quote next to the generation action.'
);
assert.match(
  assistantSource,
  /function updateAssistantCreditEstimate\(\)[\s\S]*?quoteMediaCredits[\s\S]*?imageProviderId:[\s\S]*?videoProviderId:[\s\S]*?count:[\s\S]*?resolution:[\s\S]*?duration:/,
  'The assistant quote must react to the selected model, count, video resolution and duration.'
);
assert.match(
  assistantSource,
  /kind === 'chat'[\s\S]*?renderAssistantCreditEstimate\(0\)/,
  'Chat must remain free and hide the media-credit quote.'
);

process.stdout.write('Credit pricing tests passed.\n');
