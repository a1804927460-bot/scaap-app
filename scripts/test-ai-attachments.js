'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  attachmentKind,
  normalizeAttachmentName,
  parseAiArtifacts,
  prepareTextAttachment,
  truncateText
} = require('../lib/ai-attachments');

assert.strictEqual(attachmentKind({ name: 'notes.md', mimeType: 'text/markdown' }), 'text');
assert.strictEqual(attachmentKind({ name: 'brief.pdf', mimeType: 'application/pdf' }), 'pdf');
assert.strictEqual(attachmentKind({ name: 'brief.docx' }), 'document');
assert.strictEqual(attachmentKind({ name: 'clip.mp4', mimeType: 'video/mp4' }), 'video');
assert.strictEqual(normalizeAttachmentName('../../bad:name.csv'), 'bad_name.csv');
assert.strictEqual(truncateText('hello', 10).text, 'hello');
assert.strictEqual(truncateText('01234567890', 10).truncated, true);

const parsed = parseAiArtifacts([
  'Your file is ready.',
  '<messs-file filename="report.csv" mime="text/csv">',
  'name,value',
  'alpha,1',
  '</messs-file>'
].join('\n'));
assert.strictEqual(parsed.artifacts.length, 1);
assert.strictEqual(parsed.artifacts[0].name, 'report.csv');
assert.strictEqual(parsed.artifacts[0].content, 'name,value\nalpha,1');
assert.match(parsed.text, /\[File: report\.csv\]/);
assert.strictEqual(parseAiArtifacts('<messs-file filename="app.exe">binary</messs-file>').artifacts.length, 0);

(async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'messs-ai-attachment-'));
  try {
    const filePath = path.join(tempDir, 'notes.md');
    await fs.promises.writeFile(filePath, '# Notes\nThe deadline is Friday.', 'utf8');
    const attachment = await prepareTextAttachment({
      id: 'notes-1',
      name: 'notes.md',
      mimeType: 'text/markdown',
      sizeBytes: 32,
      storedPath: filePath
    });
    assert.strictEqual(attachment.readable, true);
    assert.match(attachment.content, /deadline is Friday/);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
  console.log('AI attachment tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
