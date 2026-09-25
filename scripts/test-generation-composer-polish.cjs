'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const controls = fs.readFileSync(path.join(root, 'src', 'styles', 'generation-controls.css'), 'utf8');
const motion = fs.readFileSync(path.join(root, 'src', 'styles', 'ui-motion.css'), 'utf8');
const board = fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8');

assert.match(controls, /\.ai-image-popover\.ai-composer:not\(\.is-moodboard-composer\)[\s\S]*?min-height: 198px;/,
  'The canvas composer should keep the larger, calmer prompt surface.');
assert.match(controls, /\.ai-composer:not\(\.is-moodboard-composer\) \.ai-composer-footer[\s\S]*?border-top:/,
  'The canvas composer should separate prompt content from its action rail.');
assert.match(controls, /\.ai-image-popover\.ai-composer\.is-moodboard-composer[\s\S]*?messs-moodboard-composer-in/,
  'The moodboard composer should share the polished surface and anchored entrance.');
assert.match(controls, /\.ai-image-popover\.ai-composer:not\(\.is-moodboard-composer\)\.is-closing[\s\S]*?messs-generation-composer-out/,
  'The canvas composer should keep a distinct closing transition.');
assert.match(controls, /\.ai-composer \.ai-generation-status:not\(:empty\)::before[\s\S]*?messs-generation-status-pulse/,
  'Visible generation status should provide restrained progress feedback.');
assert.match(controls, /\.ai-assistant-form-footer[\s\S]*?border-top:/,
  'The main Agent composer should use the same action-rail hierarchy.');
assert.match(controls, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/,
  'Composer motion must respect reduced-motion preferences.');
assert.match(controls, /@media \(max-width: 760px\)[\s\S]*?\.ai-composer:not\(\.is-moodboard-composer\) \.ai-options-panel[\s\S]*?left: 8px;[\s\S]*?right: 8px;/,
  'Generation settings should remain fully inside the composer on narrow screens.');
assert.match(motion, /\.ai-composer-submit[\s\S]*?\.ai-model-picker-trigger/,
  'Generation controls should receive the shared press feedback.');

assert.match(board, /function buildAiComposer\([\s\S]*?\.ai-composer-prompt[\s\S]*?\.ai-composer-footer/,
  'The existing canvas composer behavior and controls must remain intact.');
assert.match(board, /class="ai-composer-optimize"[\s\S]*?使用 Agent 优化提示词/,
  'The canvas composer should expose prompt optimization next to its close action.');
assert.match(board, /optimizePrompt\.addEventListener\('mousedown'[\s\S]*?preventDefault[\s\S]*?optimizePrompt\.addEventListener\('click'[\s\S]*?openPromptOptimizerDialog\(prompt, selectedOnly/,
  'The prompt optimizer button should preserve text selection and reuse the confirmation workflow.');
assert.match(controls, /:is\(\.ai-composer-close, \.ai-composer-optimize\)[\s\S]*?visibility:hidden/,
  'Prompt optimization and close actions should stay behind the expanded settings panel.');

process.stdout.write('Generation composer polish tests passed.\n');
