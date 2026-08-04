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
  /aiImageGenerating \+= 1;[\s\S]*?aiImageGenerating = Math\.max\(0, aiImageGenerating - 1\);/,
  'Canvas generation must track independent in-flight tasks.'
);

assert.doesNotMatch(
  assistantSource,
  /async function submitAssistantMessage\(\)\s*\{\s*if \(AiAssistant\.busy\) return;/,
  'The assistant must accept another submission while media is being generated.'
);
assert.match(
  assistantSource,
  /const submittedKind = AiAssistant\.kind;[\s\S]*?kind: submittedKind/,
  'Each assistant task must capture its own generation mode.'
);
assert.match(
  assistantSource,
  /activeTasks: 0[\s\S]*?AiAssistant\.activeTasks = Math\.max\(0, AiAssistant\.activeTasks \+ \(busy \? 1 : -1\)\)/,
  'The assistant must count independent in-flight tasks.'
);

process.stdout.write('Concurrent media UI tests passed.\n');
