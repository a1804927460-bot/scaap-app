const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const assistantSource = fs.readFileSync(path.join(root, 'src', 'js', 'ai-assistant.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'js', 'sidebar.js'), 'utf8');

const footerStart = html.indexOf('<div class="ai-assistant-form-footer">');
const modeStart = html.indexOf('<div class="ai-assistant-mode"');
const submitStart = html.indexOf('id="ai-assistant-submit"');
assert(footerStart >= 0 && modeStart > footerStart && submitStart > modeStart,
  'AI mode controls should live in the composer footer before the submit button');

const quickActions = ['poster', 'logo', 'clarify', 'short-video'];
quickActions.forEach((action) => {
  assert(html.includes(`data-ai-quick-action="${action}"`), `missing ${action} quick action`);
});
assert.strictEqual((html.match(/data-ai-quick-action=/g) || []).length, 4,
  'the AI home should expose exactly four quick actions');
assert.match(html, /data-assistant-kind="chat"[^>]*>Agent<\/button>/,
  'the chat mode should be labelled Agent');
assert.match(html, /id="ai-assistant-upload"[\s\S]*?M14 2H6[\s\S]*?M12 11v6/,
  'the attachment action should use a recognizable file-add icon');

['image', 'video'].forEach((kind) => {
  const pattern = new RegExp(`data-assistant-kind="${kind}"[\\s\\S]*?<svg[\\s\\S]*?<\\/svg>[\\s\\S]*?<\\/button>`);
  assert(pattern.test(html), `${kind} mode should remain an icon button`);
  assert(!sidebarSource.includes(`setText('[data-assistant-kind="${kind}"]'`),
    `${kind} localization must not replace its SVG with text`);
});

assert(assistantSource.includes("button.dataset.aiQuickAction === 'poster'"),
  'assistant language refresh should distinguish the two image quick actions');
assert(css.includes('.ai-assistant-footer-start { min-width: 0; margin-right: auto;'),
  'the AI footer tools should align to the lower left');
assert(css.includes('.ai-assistant-home h2 { font-size: 24px; }'),
  'the AI heading should use the larger coordinated type scale');
assert(css.includes('.ai-chat-history-item {') && css.includes('font-size: 15px;'),
  'AI history text should match the larger reference scale');
assert.match(
  assistantSource,
  /function syncAssistantImageSizeRatio[\s\S]*?imageSizeForRatio[\s\S]*?imageRatioForSize[\s\S]*?id === 'ai-assistant-ratio'[\s\S]*?id === 'ai-assistant-size'/,
  'GPT image size and ratio selections must stay synchronized in the assistant.'
);
assert.match(
  assistantSource,
  /const panel = document\.getElementById\('ai-assistant-panel'\)[\s\S]*?panel\.addEventListener\('contextmenu', showAgentTextContextMenu\)[\s\S]*?\['a', 'c', 'v', 'x'\][\s\S]*?event\.stopPropagation\(\)/,
  'AI chat must expose text clipboard actions without leaking shortcuts into the canvas.'
);
assert.match(
  css,
  /\.ai-assistant-message-body \{[\s\S]*?user-select:\s*text;/,
  'AI replies must remain selectable for keyboard and context-menu copying.'
);
assert.match(
  assistantSource,
  /function syncAssistantCompactMode\(panel\)[\s\S]*?width < 380[\s\S]*?width <= 360[\s\S]*?is-chat-only-compact[\s\S]*?setAssistantKind\('chat'\)[\s\S]*?new ResizeObserver/,
  'narrow AI panels must switch to Agent-only mode and keep observing resizes.'
);
assert.match(
  css,
  /\.ai-assistant-panel\.is-chat-only-compact \[data-assistant-kind="image"\][\s\S]*?\.ai-assistant-tools[\s\S]*?display: none !important/,
  'Agent-only mode must remove media and model controls that no longer fit.'
);

console.log('AI assistant layout checks passed');
