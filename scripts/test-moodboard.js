'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'js', 'moodboard.js'), 'utf8');
const board = fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'src', 'js', 'canvas-workspace.js'), 'utf8');
const contextMenu = fs.readFileSync(path.join(root, 'src', 'js', 'context-menu.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const packageJson = require(path.join(root, 'package.json'));
const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');

const sandbox = { window: {}, console, setTimeout, clearTimeout };
vm.runInNewContext(`${source}\nthis.moodboardTestApi = { normalizeMoodboardDelta, moodboardPlainTextFromDelta };`, sandbox);
const api = sandbox.moodboardTestApi;
const normalized = api.normalizeMoodboardDelta({
  ops: [
    { insert: 'Keep', attributes: { bold: true, link: 'https://example.com', color: '#f00' } },
    { insert: { image: 'data:image/png;base64,unsafe' } },
    { insert: '\n', attributes: { header: 2, script: 'super' } },
    { insert: { video: 'file:///unsafe.mp4' } }
  ]
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(normalized)), {
  ops: [
    { insert: 'Keep', attributes: { bold: true } },
    { insert: '\n', attributes: { header: 2 } }
  ]
}, 'Moodboard Delta persistence must keep text formatting while rejecting embeds and unsupported attributes.');
assert.strictEqual(api.moodboardPlainTextFromDelta(normalized), 'Keep');
assert(api.moodboardPlainTextFromDelta({ ops: [{ insert: 'x'.repeat(50000) }] }).length <= 40000);

assert.strictEqual(packageJson.dependencies.quill, '2.0.3', 'Quill must stay pinned to the reviewed version.');
assert.match(notices, /Quill[\s\S]*github\.com\/slab\/quill[\s\S]*BSD 3-Clause License/);
assert.match(index, /id="board-tool-moodboard"[\s\S]*title="Moodboard"/);
assert.match(index, /id="board-tool-ai-video"[\s\S]*id="board-tool-text"[\s\S]*id="board-tool-doodle"[\s\S]*id="board-tool-moodboard"/,
  'Canvas creation tools must end with video, text, pen, then moodboard.');
assert.match(index, /quill\.snow\.css[\s\S]*quill\.js[\s\S]*js\/moodboard\.js[\s\S]*js\/board-canvas\.js/,
  'Quill and the moodboard module must load before the canvas initializes.');
assert.match(index, /id="moodboard-overlay"[\s\S]*data-moodboard-agent-action="polish"[\s\S]*id="moodboard-editor"[\s\S]*id="moodboard-agent-suggestion"/);

assert.match(source, /function normalizeMoodboardDelta[\s\S]*typeof operation\.insert !== 'string'/,
  'Only text inserts may enter a moodboard Delta.');
assert.match(source, /root\.addEventListener\('paste'[\s\S]*getData\('text\/plain'\)[\s\S]*root\.addEventListener\('drop'/,
  'External clipboard and drop input must stay text-only.');
assert.match(source, /function createBoardMoodboard[\s\S]*isMoodboard: true[\s\S]*recordBoardItemsHistory\('add'[\s\S]*moodboardPersistItem/,
  'Moodboards must be durable canvas items with undo history.');
assert.match(source, /if \(options\.open === true\)[\s\S]*openMoodboardEditor\(item\)/,
  'A newly created moodboard must stay closed unless an entry point explicitly asks to open it.');
assert.doesNotMatch(source, /createBoardMoodboard\(\{\s*text:\s*value,\s*open:\s*true\s*\}\)/,
  'Creating a moodboard from Agent text must not open the editor automatically.');
assert.match(source, /function openMoodboardEditor[\s\S]*classList\.add\('is-open'\)[\s\S]*function closeMoodboardEditor/,
  'Double-click editing must use the dedicated half-screen editor.');
assert.match(source, /function requestMoodboardAgentOptimization[\s\S]*referenceFiles: \[\][\s\S]*moodboardSuggestion/,
  'Moodboard Agent requests must be text-only and stage a suggestion before applying it.');
assert.match(source, /function moodboardApplySuggestion[\s\S]*mode === 'replace'[\s\S]*moodboardAppendDelta/,
  'Agent suggestions must support explicit replace and append decisions.');
assert.match(source, /function openMoodboardTargetPicker[\s\S]*moodboardItemsForCanvas[\s\S]*createBoardMoodboard[\s\S]*addAgentTextToMoodboard/,
  'Agent feedback must target an existing moodboard or create one safely.');

assert.match(board, /clipboardItem\.isMoodboard \? 'moodboard_'/);
assert.match(board, /item\.isMoodboard\) return buildBoardMoodboardElement\(item\)/);
assert.match(board, /item\.isAiPlaceholder \|\| item\.isMoodboard/,
  'Moodboards must remain mountable without a backing media file.');
assert.match(board, /typeof initBoardMoodboards === 'function'\) initBoardMoodboards\(\)/);
assert.match(contextMenu, /Send to canvas[\s\S]*openMoodboardTargetPicker\(text\)/);
assert.match(contextMenu, /item\.isMoodboard[\s\S]*openMoodboardEditor\(item\)/);
assert.match(workspace, /async function requestCanvasAgentText[\s\S]*chatWithAgentEstimate\(pending,[\s\S]*options\.onResponse/);
assert.match(main, /b\.isNote \|\| b\.isDoodle \|\| b\.isMoodboard/,
  'Missing-file cleanup must preserve persisted moodboards.');
assert.match(styles, /\.board-moodboard \{[\s\S]*?border-radius: 8px[\s\S]*?\.moodboard-overlay \{[\s\S]*?place-items: center[\s\S]*?\.moodboard-editor-panel[\s\S]*?width: min\(72vw, 980px\)[\s\S]*?height: min\(76vh, 760px\)[\s\S]*?border-radius: 8px/,
  'The moodboard editor must open as a centered, rounded half-screen dialog.');
assert.match(styles, /moodboard-editor-workspace:has\(\.moodboard-agent-suggestion:not\(\[hidden\]\)\)[\s\S]*?grid-template-columns/);
assert.match(styles, /\.moodboard-editor \.ql-editor \{[\s\S]*?font-size: 18px[\s\S]*?line-height: 1\.72/,
  'Moodboard editor text must remain large and readable.');
assert.match(styles, /\.board-canvas\[data-board-renderer="leafer"\] \.board-text-note-content \{[\s\S]*?color: #f3f5f8[\s\S]*?font-size: 32px/,
  'Confirmed text notes must keep a large white canvas fallback style.');
assert.match(fs.readFileSync(path.join(root, 'src', 'js', 'board-leafer-layer.js'), 'utf8'), /function textColorForItem[\s\S]*?colorMode === 'auto'[\s\S]*?dataset.theme === 'light' \? '#15171c' : '#f3f5f8'/,
  'Leafer automatic text colors must follow the selected theme.');

process.stdout.write('Text moodboard tests passed.\n');
