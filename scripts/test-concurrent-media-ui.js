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
