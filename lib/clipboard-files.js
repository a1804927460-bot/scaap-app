'use strict';
/**
 * Builds the raw bytes for the Windows CF_HDROP clipboard format, which is
 * what lets a file copied programmatically be pasted as an actual file in
 * Explorer (or any other app that accepts pasted/dropped files) — the same
 * format Explorer itself writes when you press Ctrl+C on a file.
 *
 * Structure (see MSDN's DROPFILES struct):
 *   DWORD pFiles   — byte offset from the start of this struct to the file list (always 20 here)
 *   POINT pt       — drop point; irrelevant for clipboard use, zeroed out
 *   BOOL  fNC      — 0
 *   BOOL  fWide    — 1, since we always write UTF-16LE paths for correct Unicode support
 * followed by each file path as a null-terminated UTF-16LE string, with one
 * extra null terminator after the last path to mark the end of the list.
 */

const HEADER_SIZE = 20; // 4 (pFiles) + 8 (POINT) + 4 (fNC) + 4 (fWide)

function buildCfHDrop(filePaths) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(HEADER_SIZE, 0); // pFiles
  header.writeInt32LE(0, 4);            // pt.x
  header.writeInt32LE(0, 8);            // pt.y
  header.writeUInt32LE(0, 12);          // fNC
  header.writeUInt32LE(1, 16);          // fWide = TRUE

  const pathBuffers = filePaths.map((p) => Buffer.from(p + '\u0000', 'utf16le'));
  const finalNull = Buffer.from('\u0000', 'utf16le');

  return Buffer.concat([header, ...pathBuffers, finalNull]);
}

module.exports = { buildCfHDrop, HEADER_SIZE };
