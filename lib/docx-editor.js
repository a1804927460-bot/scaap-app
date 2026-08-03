'use strict';
/**
 * Lets the board canvas's simplified Word editor load and save .docx files.
 *
 * Loading (docxToHtml): uses `mammoth`, which converts the real document
 * structure (headings, paragraphs, bold/italic/underline, lists) to clean
 * HTML — good fidelity for viewing and for re-editing text content.
 *
 * Saving (htmlToDocx): Messs.'s editor toolbar only ever produces a small,
 * known set of tags (p, br, b/strong, i/em, u, ul/li, h1-h3), so saving uses
 * a small hand-written HTML walker — rather than a full HTML parser — to
 * rebuild a valid .docx with the `docx` library. This intentionally does
 * NOT preserve the original file's complex formatting (tables, images,
 * custom styles, columns, etc.) on round-trip: editing and resaving a richly
 * formatted Word document will simplify it down to headings/paragraphs/
 * basic inline formatting. See README "Editing Word documents in Messs."
 */
const fs = require('fs');

async function docxToHtml(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.convertToHtml({ path: filePath });
  return result.value;
}

/** Very small HTML -> docx AST walker covering exactly what the editor's toolbar can produce. */
function parseInlineRuns(fragment) {
  const { TextRun } = require('docx');
  const runs = [];
  const tagPattern = /<(\/?)(b|strong|i|em|u)>|([^<]+)/gi;
  let bold = false, italic = false, underline = false;
  let match;
  while ((match = tagPattern.exec(fragment)) !== null) {
    const [, closing, tag, text] = match;
    if (text !== undefined) {
      if (text.length === 0) continue;
      runs.push(new TextRun({
        text: decodeEntities(text),
        bold: bold || undefined,
        italics: italic || undefined,
        underline: underline ? {} : undefined
      }));
    } else if (tag) {
      const isOn = !closing;
      const lower = tag.toLowerCase();
      if (lower === 'b' || lower === 'strong') bold = isOn;
      else if (lower === 'i' || lower === 'em') italic = isOn;
      else if (lower === 'u') underline = isOn;
    }
  }
  return runs;
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getHeadingMap() {
  const { HeadingLevel } = require('docx');
  return { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 };
}

function htmlToParagraphs(html) {
  const { Paragraph, TextRun } = require('docx');
  const HEADING_MAP = getHeadingMap();
  const paragraphs = [];
  const blockPattern = /<(p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  let foundAny = false;

  while ((match = blockPattern.exec(html)) !== null) {
    foundAny = true;
    const [, tag, inner] = match;
    const lower = tag.toLowerCase();
    const cleanedInner = inner.replace(/<br\s*\/?>/gi, '\n');
    const lines = cleanedInner.split('\n');

    lines.forEach((line, i) => {
      const runs = parseInlineRuns(line);
      paragraphs.push(new Paragraph({
        heading: HEADING_MAP[lower] || undefined,
        bullet: lower === 'li' ? { level: 0 } : undefined,
        children: runs.length ? runs : [new TextRun('')]
      }));
    });
  }

  if (!foundAny && html.trim()) {
    // Plain text with no block tags at all (e.g. pasted text) — treat each line as its own paragraph.
    for (const line of html.split(/<br\s*\/?>|\n/i)) {
      paragraphs.push(new Paragraph({ children: parseInlineRuns(line) }));
    }
  }

  return paragraphs.length ? paragraphs : [new Paragraph('')];
}

async function htmlToDocx(html, outPath) {
  const { Document, Packer } = require('docx');
  const doc = new Document({
    sections: [{ children: htmlToParagraphs(html) }]
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}

module.exports = { docxToHtml, htmlToDocx };
