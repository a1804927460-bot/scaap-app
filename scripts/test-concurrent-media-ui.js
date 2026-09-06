'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');

assert.doesNotMatch(
  boardSource,
  /async function generateAiMediaForBoardV3\(request\)\s*\{\s*if \(aiImageGenerating\) return;/,
  'Canvas media generation must not reject a second task while another task is running.'
);
assert.doesNotMatch(
  boardSource,
  /async function submitBoardQuickGeneration\([^)]*\)\s*\{\s*if \(aiImageGenerating/,
  'Quick generation must remain available while another task is running.'
);
assert.match(
  boardSource,
  /const aiMediaTasks = new Map\(\);[\s\S]*?beginAiMediaTask\(request\)[\s\S]*?finishAiMediaTask\(taskId\)/,
  'Canvas generation must track independent in-flight tasks.'
);

assert.doesNotMatch(
  assistantSource,
  /async function submitAssistantMessage\(\)\s*\{\s*if \(AiAssistant\.busy\) return;/,
  'The assistant must accept another submission while media is being generated.'
);
assert.match(
  assistantSource,
  /kind: AiAssistant\.kind[\s\S]*?const submittedKind = item\.kind;[\s\S]*?kind: submittedKind/,
  'Each assistant task must capture its own generation mode.'
);
assert.match(assistantSource, /canvasId: activeCanvasId\(\)[\s\S]*?canvasId: item\.canvasId/,
  'Queued generation must retain the canvas captured at submission.');
assert.match(
  assistantSource,
  /activeTasks: 0[\s\S]*?AiAssistant\.activeTasks = Math\.max\(0, AiAssistant\.activeTasks \+ \(busy \? 1 : -1\)\)/,
  'The assistant must count independent in-flight tasks.'
);
assert.doesNotMatch(
  assistantSource,
  /setAssistantBusy\(busy\)[\s\S]{0,500}?submit\.disabled\s*=\s*AiAssistant\.busy/,
  'A running assistant task must not disable the submit action for the next task.'
);

process.stdout.write('Concurrent media UI tests passed.\n');

async function testCompletionDestination() {
  const vm = require('node:vm');
  const source = boardSource.slice(boardSource.indexOf('function aiMediaCanvasCompletionMessage('), boardSource.indexOf('let boardQuickGenerateOutsideClick'));
  const notices = [];
  const state = { activeCanvasId: 'origin', canvases: [{ id: 'origin', name: 'EVEN' }, { id: 'other', name: 'Other' }], files: [] };
  const context = vm.createContext({
    AppState: state, t: (en, zh) => zh,
    activeCanvasId: () => state.activeCanvasId,
    beginAiMediaTask: () => 'task', finishAiMediaTask() {}, createAiPlaceholders: () => [],
    removeAiPlaceholders() {}, replaceAiPlaceholders: async () => {},
    confirmAiMediaDeliveries: async files => files, renderFileList() {}, currentFileListScope() {},
    renderFolderGridIfActive() {}, selectFileForPreview() {}, showToast: (message, type) => notices.push({ message, type }),
    window: { MesssCredits: { ensure: async () => ({ ok: true }) }, messsAPI: { generateAiMedia: async request => {
      assert.equal(request.canvasId, 'origin');
      state.activeCanvasId = 'other';
      return { ok: true, files: [{ id: 'result' }] };
    } } }
  });
  vm.runInContext(source, context);
  await context.generateAiMediaForBoardV3({ kind: 'image' });
  assert.deepEqual(notices.pop(), { message: '1 张 AI 图片已加入【EVEN】画布', type: 'AI' });
  state.canvases[0].name = 'Renamed';
  assert.equal(context.aiMediaCanvasCompletionMessage('video', 2, 'origin', 1), '2 个 AI 视频已加入【Renamed】画布；1 个失败');
  assert.equal(context.aiMediaCanvasCompletionMessage('image', 1, 'deleted'), '1 张 AI 图片已加入原画布');
  context.t = en => en;
  assert.equal(context.aiMediaCanvasCompletionMessage('image', 1, 'origin'), '1 AI image added to canvas [Renamed]');
  state.activeCanvasId = 'origin'; context.t = (en, zh) => zh;
  await context.generateAiMediaForBoardV3({ kind: 'video', placeOnBoard: false });
  assert.equal(notices.pop().message, '生成完成');
  console.log('Completion toast: switched canvas, renamed target, partial success, missing target and non-canvas generation passed.');
}
testCompletionDestination().catch(error => { console.error(error); process.exitCode = 1; });
