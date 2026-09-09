const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const interfaceCss = fs.readFileSync(path.join(root, 'src', 'styles', 'agent-interface.css'), 'utf8');
const statsSource = fs.readFileSync(path.join(root, 'src', 'js', 'stats-detail.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(root, 'src', 'js', 'ai-assistant.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'js', 'sidebar.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'lib', 'store.js'), 'utf8');

assert.match(
  html,
  /class="ai-assistant-brand"[\s\S]*?src="assets\/logo-mark\.png"[\s\S]*?class="ai-assistant-brand-word">Messs<span class="ai-assistant-brand-dot"/,
  'the Agent header should use the Messs logo and wordmark instead of a plain text title'
);
assert.match(css, /\.ai-assistant-brand\s*\{[\s\S]*?display: flex;[\s\S]*?align-items: center;/,
  'the Agent header brand should keep its mark and wordmark aligned');
assert.match(html, /id="ai-assistant-sidebar-toggle"[^>]*aria-expanded="true"/,
  'the Agent history sidebar should start expanded and expose a collapse control');
assert.match(statsSource, /sidebarToggle\.addEventListener\('click',[\s\S]*?classList\.toggle\('is-history-collapsed'\)[\s\S]*?aria-expanded/,
  'the sidebar control must synchronize its collapsed state and accessibility label');
assert.match(interfaceCss, /\.is-history-collapsed \.ai-assistant-header\s*\{[\s\S]*?flex-direction:column;[\s\S]*?justify-content:center;/,
  'the collapsed rail must stack the logo and toggle instead of overlapping them');
assert.match(interfaceCss, /\.is-history-collapsed \.ai-assistant-brand-word\s*\{\s*display:none;/,
  'the collapsed rail should retain the logo mark while hiding only the wordmark');

const footerStart = html.indexOf('<div class="ai-assistant-form-footer">');
const modeStart = html.indexOf('<div class="ai-assistant-mode"');
const submitStart = html.indexOf('id="ai-assistant-submit"');
assert(footerStart >= 0 && modeStart > footerStart && submitStart > modeStart,
  'AI mode controls should live in the composer footer before the submit button');

const quickActions = ['music-cover', 'stage-visual', 'logo'];
quickActions.forEach((action) => {
  assert(html.includes(`data-ai-quick-action="${action}"`), `missing ${action} quick action`);
});
assert.strictEqual((html.match(/data-ai-quick-action=/g) || []).length, 3,
  'the AI home should expose exactly three quick actions');
assert.match(html, /data-assistant-kind="chat"[^>]*>Agent<\/button>/,
  'the chat mode should be labelled Agent');
assert.match(html, /id="ai-assistant-upload"[\s\S]*?m21\.44 11\.05[\s\S]*?M18\.5 15\.5v5[\s\S]*?M16 18h5/,
  'the attachment action should use the Canvas Agent paperclip-plus icon');
assert.match(css, /\.ai-assistant-upload-top\s*\{[\s\S]*?width: 38px;[\s\S]*?height: 38px;[\s\S]*?background: var\(--action-gradient\);/,
  'the assistant attachment action should match the larger Canvas Agent action button');
assert.match(css, /\.ai-assistant-upload-top svg \{ width: 20px; height: 20px; \}/,
  'the assistant attachment icon should not be rendered at the old tiny size');
assert.match(css, /\.ai-assistant-mode button\.ai-assistant-upload-top\s*\{[\s\S]*?height: 38px;[\s\S]*?padding: 0;[\s\S]*?color: #fff;/,
  'the assistant attachment action should keep the Canvas Agent height and white icon after mode button rules');
['ai-assistant-ratio', 'ai-assistant-size', 'ai-assistant-count', 'ai-assistant-duration'].forEach((id) => {
  assert(html.includes(`data-option-picker="${id}"`), `missing canvas-style picker for ${id}`);
});
assert(css.includes('.ai-assistant-option-menu {') && css.includes('.ai-assistant-option-choice {'),
  'assistant generation settings should use the canvas-style option menu');
assert.match(assistantSource, /function refreshAssistantOptionPickers[\s\S]*?function initAssistantOptionPickers[\s\S]*?select.value = choice.dataset.optionValue/,
  'assistant option pickers must stay synchronized with their existing select state');

['image', 'video'].forEach((kind) => {
  const pattern = new RegExp(`data-assistant-kind="${kind}"[\\s\\S]*?<svg[\\s\\S]*?<\\/svg>[\\s\\S]*?<\\/button>`);
  assert(pattern.test(html), `${kind} mode should remain an icon button`);
  assert(!sidebarSource.includes(`setText('[data-assistant-kind="${kind}"]'`),
    `${kind} localization must not replace its SVG with text`);
});

assert(assistantSource.includes("button.dataset.aiQuickAction === 'music-cover'") && assistantSource.includes("button.dataset.aiQuickAction === 'stage-visual'"),
  'assistant language refresh should distinguish music cover and stage visual actions');
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
  /function assistantImageReferenceAutoActive[\s\S]*?function syncAssistantReferenceAutoMode[\s\S]*?referenceAutoState[\s\S]*?ratioSelect\.value = 'auto'[\s\S]*?sizeSelect\.value = 'auto'/,
  'image references must switch the assistant to automatic ratio and size selection.'
);
assert.match(
  assistantSource,
  /function syncAssistantMediaOptions[\s\S]*?syncAssistantReferenceAutoMode\(\)[\s\S]*?renderAssistantRatios\(\{ syncReferenceAuto: false \}\)[\s\S]*?assistantImageReferenceAutoActive\(\)/,
  'reference auto sizing must be applied while media options are rebuilt.'
);
assert.match(
  assistantSource,
  /function assistantVideoRatios[\s\S]*?textRatios[\s\S]*?frameReferenceRatios[\s\S]*?function supportedAssistantVideoRatio[\s\S]*?ratios\.includes\('adaptive'\)/,
  'video ratios must follow the exact attachment-dependent generation mode.'
);
assert.match(
  assistantSource,
  /submittedMediaOptions\.videoMode = selectedVideoMode\.id;[\s\S]*?submittedMediaOptions\.aspectRatio = supportedAssistantVideoRatio/,
  'video submissions must normalize stale ratios against the final selected mode.'
);
assert.match(
  assistantSource,
  /const saved = AiAssistant\.referenceAutoState[\s\S]*?ratioSelect\.disabled = saved\.ratioDisabled === true[\s\S]*?sizeSelect\.disabled = saved\.sizeDisabled === true[\s\S]*?saved\.ratio[\s\S]*?saved\.size/,
  'removing references must restore the previous ratio and size controls.'
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
assert.match(
  assistantSource,
  /async function loadAiChatHistory\(\)[\s\S]*?getAiAssistantHistory[\s\S]*?mergeAiChatSessions\(durable, local, AiAssistant\.sessions\)/,
  'Agent history must merge legacy renderer history into durable main-process storage.'
);
assert.match(assistantSource, /saveAiAssistantHistory/);
assert.match(
  assistantSource,
  /historyFavoritesOnly[\s\S]*?historyDate[\s\S]*?Pin conversation[\s\S]*?session\.favorite = !session\.favorite/,
  'Agent history must retain compatibility state and provide a right-click pin action.'
);
assert.match(html, /id="ai-chat-history-favorites"[\s\S]*?id="ai-chat-history-list"/,
  'The Agent history sidebar must expose pin filtering and the conversation list.');
assert.match(
  html,
  /class="ai-chat-history-sections"[\s\S]*?data-history-section="pinned"[\s\S]*?id="ai-chat-history-pinned-list"[\s\S]*?data-history-section="recent"[\s\S]*?id="ai-chat-history-list"/,
  'The Agent history sidebar must expose separate text-labeled pinned and recent sections.'
);
assert.doesNotMatch(html, /<button id="ai-chat-history-favorites"/,
  'Pinned must be a history section, not a legacy filter button.');
assert.match(
  assistantSource,
  /const pinnedSessions = sessions\.filter\(\(session\) => session\.favorite === true\)[\s\S]*?const recentSessions = sessions\.filter\(\(session\) => session\.favorite !== true\)[\s\S]*?pinnedSessions\.forEach[\s\S]*?recentSessions\.forEach/,
  'Agent history must place pinned conversations only in Pinned and all other conversations in Recent.'
);
assert.match(
  assistantSource,
  /function handleAiChatHistoryDrop\(event, targetSection\)[\s\S]*?dragged\.favorite = destination === 'pinned'/,
  'Agent history drag-and-drop must explicitly move conversations between the two sections.'
);
assert.doesNotMatch(html, /id="ai-chat-history-date"/,
  'The Agent history sidebar must not render the removed date filter.');
assert.match(storeSource, /canvasAgentHistory:\s*\[\][\s\S]*?aiAssistantHistory:\s*\[\]/,
  'Both Agent surfaces must have update-safe store defaults.');
assert.match(mainSource, /sanitizeAiAssistantHistory[\s\S]*?ipcMain\.handle\('ai-assistant:getHistory'[\s\S]*?ipcMain\.handle\('ai-assistant:saveHistory'/,
  'The main process must sanitize and persist regular Agent history.');
assert.match(preloadSource, /getAiAssistantHistory[\s\S]*?saveAiAssistantHistory/,
  'The renderer must access durable Agent history only through scoped preload IPC methods.');
assert.match(
  html,
  /id="ai-assistant-quality-buttons"[\s\S]*?data-quality="low"[\s\S]*?data-quality="medium"[\s\S]*?data-quality="high"/,
  'GPT Image 2 must expose low, medium, and high quality controls.'
);
assert.match(html, /id="ai-assistant-variant-buttons"[\s\S]*?data-variant="flare"[\s\S]*?data-variant="sunburst"/,
  'GPT Image 2.5 must expose Flare and Sunburst inside one generation settings panel.');
assert.match(assistantSource, /variant:\s*submittedKind === 'image' \? submittedMediaOptions\.variant/,
  'Assistant generation requests must forward the selected GPT Image 2.5 variant.');
assert.match(
  assistantSource,
  /quality:\s*submittedKind === 'image'[\s\S]*?createAiPlaceholders\(request\)[\s\S]*?request\.placements = mediaPlaceholders\.map[\s\S]*?replaceAiPlaceholders\(mediaPlaceholders, files, request, response\.boardItems \|\| \[\]\)/,
  'Assistant media requests must preserve GPT quality and confirm delivery against persisted canvas placements.'
);
assert.match(
  assistantSource,
  /catch \(err\) \{[\s\S]*?removeAiPlaceholders\(mediaPlaceholders\)/,
  'Failed assistant generation must remove its pending canvas placements.'
);
assert.match(
  assistantSource,
  /function assistantVideoResolutionGroups[\s\S]*?id: 'native'[\s\S]*?id: 'upscaled'[\s\S]*?id: 'enhanced'/,
  'The assistant must classify Seedance native, upscaled, and enhanced-upscale resolutions independently.'
);
assert.match(
  assistantSource,
  /document\.createElement\('optgroup'\)[\s\S]*?dataset\.resolutionTier = group\.id[\s\S]*?appendResolutionOption\(optionGroup, value\)/,
  'The assistant resolution selector must render the Seedance tiers as labelled option groups.'
);

console.log('AI assistant layout checks passed');
