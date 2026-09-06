'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
const MAX_ATTACHMENT_CHARS = 48_000;
const MAX_PDF_PAGES = 80;
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.css', '.scss', '.less', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift',
  '.kt', '.kts', '.sql', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.ini', '.toml',
  '.conf', '.config', '.log', '.srt', '.vtt', '.rtf', '.svg', '.obj', '.mtl', '.gltf', '.stl'
]);
const GENERATED_TEXT_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  '.text'
]);

function truncateText(value, limit = MAX_ATTACHMENT_CHARS) {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}\n\n[Attachment truncated by Messs at ${limit} characters.]`,
    truncated: true
  };
}

function normalizeAttachmentName(value, fallback = 'attachment.txt') {
  const cleaned = path.basename(String(value || fallback))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function attachmentKind(file) {
  const mimeType = String(file && file.mimeType || '').toLowerCase();
  const ext = String(file && (file.ext || path.extname(file.name || '')) || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (ext === '.pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'document';
  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/') || /(?:json|xml|yaml|javascript|typescript|csv)/i.test(mimeType)) return 'text';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const devPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist');
    const unpackedPath = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'pdfjs-dist');
    const root = fs.existsSync(unpackedPath) ? unpackedPath : devPath;
    pdfjsPromise = import(pathToFileURL(path.join(root, 'legacy', 'build', 'pdf.mjs')).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = path.join(root, 'legacy', 'build', 'pdf.worker.mjs');
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function extractPdfText(filePath) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await fs.promises.readFile(filePath));
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
  const pdf = await loadingTask.promise;
  try {
    const pages = [];
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => String(item && item.str || '')).join(' ').trim();
      if (text) pages.push(`[Page ${pageNumber}]\n${text}`);
      if (pages.join('\n\n').length >= MAX_ATTACHMENT_CHARS) break;
    }
    const suffix = pdf.numPages > pageCount ? `\n\n[Only the first ${pageCount} of ${pdf.numPages} pages were read.]` : '';
    return truncateText(`${pages.join('\n\n')}${suffix}`);
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

async function extractDocxText(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return truncateText(result.value);
}

async function extractAttachmentText(file) {
  const kind = attachmentKind(file);
  const filePath = String(file && file.storedPath || '');
  if (!filePath) return { text: '', truncated: false, readable: false };
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) return { text: '', truncated: false, readable: false };
  if (stat.size > MAX_SOURCE_BYTES) {
    return {
      text: `[File content was not extracted because it exceeds the ${MAX_SOURCE_BYTES / 1024 / 1024} MB attachment limit.]`,
      truncated: true,
      readable: false
    };
  }
  try {
    if (kind === 'pdf') return { ...(await extractPdfText(filePath)), readable: true };
    if (kind === 'document') return { ...(await extractDocxText(filePath)), readable: true };
    if (kind === 'text') {
      const buffer = await fs.promises.readFile(filePath);
      return { ...truncateText(buffer.toString('utf8')), readable: true };
    }
  } catch (error) {
    return {
      text: `[Messs could not extract this ${kind} file: ${String(error && error.message || 'unknown error').slice(0, 240)}]`,
      truncated: false,
      readable: false
    };
  }
  return { text: '', truncated: false, readable: false };
}

function attachmentMetadata(file, kind = attachmentKind(file)) {
  return {
    id: String(file && file.id || ''),
    name: normalizeAttachmentName(file && file.name, 'attachment'),
    mimeType: String(file && file.mimeType || 'application/octet-stream').slice(0, 120),
    sizeBytes: Math.max(0, Number(file && file.sizeBytes) || 0),
    kind
  };
}

async function prepareTextAttachment(file) {
  const kind = attachmentKind(file);
  const extracted = await extractAttachmentText(file);
  return {
    ...attachmentMetadata(file, kind),
    content: extracted.text,
    readable: extracted.readable,
    truncated: extracted.truncated
  };
}

function parseAiArtifacts(value) {
  let text = String(value || '');
  if ((text.match(/<messs-file\b/gi) || []).length !== (text.match(/<\/messs-file>/gi) || []).length) {
    throw new Error('文件内容未完整生成，已停止保存，避免下载损坏文件。请减少单次文件数量或简化后重试。');
  }
  const artifacts = [];
  const pattern = /<messs-file\s+filename=(?:"([^"]+)"|'([^']+)')(?:\s+mime=(?:"([^"]+)"|'([^']+)'))?\s*>([\s\S]*?)<\/messs-file>/gi;
  text = text.replace(pattern, (whole, quotedName, singleName, quotedMime, singleMime, content) => {
    const name = normalizeAttachmentName(quotedName || singleName, 'assistant.txt');
    const ext = path.extname(name).toLowerCase();
    const body = String(content || '').replace(/^\r?\n|\r?\n$/g, '');
    if (!GENERATED_TEXT_EXTENSIONS.has(ext) || Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) return whole;
    artifacts.push({
      name,
      mimeType: String(quotedMime || singleMime || 'text/plain').slice(0, 120),
      content: body,
      sizeBytes: Buffer.byteLength(body, 'utf8')
    });
    return `\n[File: ${name}]\n`;
  });
  return { text: text.trim(), artifacts: artifacts.slice(0, 6) };
}

const AI_ARTIFACT_INSTRUCTION = [
  'When the user explicitly asks you to create or send a text-based file, include the complete file in this exact format:',
  '<messs-file filename="example.txt" mime="text/plain">',
  'complete file content',
  '</messs-file>',
  'Use only text-based formats such as txt, md, csv, json, html, svg, or source-code files. Do not claim to attach a binary file.'
].join('\n');

module.exports = {
  isGeneratedTextExtension: ext => GENERATED_TEXT_EXTENSIONS.has(String(ext).toLowerCase()),
  AI_ARTIFACT_INSTRUCTION,
  MAX_ATTACHMENT_CHARS,
  MAX_SOURCE_BYTES,
  attachmentKind,
  attachmentMetadata,
  extractAttachmentText,
  normalizeAttachmentName,
  parseAiArtifacts,
  prepareTextAttachment,
  truncateText
};
