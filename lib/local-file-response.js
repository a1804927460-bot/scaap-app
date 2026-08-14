'use strict';

const fs = require('fs');

function createCancelableFileWebStream(filePath, options = {}) {
  let fileStream = null;
  let settled = false;

  return new ReadableStream({
    start(controller) {
      fileStream = fs.createReadStream(filePath, options);

      const settle = (action, value) => {
        if (settled) return;
        settled = true;
        fileStream.removeAllListeners();
        try {
          controller[action](value);
        } catch (error) {
          // A protocol request can be cancelled while the final file event is
          // queued. In that race the Web stream is already correctly settled.
          if (!error || error.code !== 'ERR_INVALID_STATE') throw error;
        }
      };

      fileStream.on('data', (chunk) => {
        if (settled) return;
        try {
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
          if (controller.desiredSize !== null && controller.desiredSize <= 0) fileStream.pause();
        } catch (error) {
          settled = true;
          fileStream.removeAllListeners();
          fileStream.destroy();
        }
      });
      fileStream.once('end', () => settle('close'));
      fileStream.once('error', (error) => settle('error', error));
    },
    pull() {
      if (!settled && fileStream && fileStream.isPaused()) fileStream.resume();
    },
    cancel() {
      if (settled) return;
      settled = true;
      if (fileStream) {
        fileStream.removeAllListeners();
        fileStream.destroy();
      }
    }
  });
}

function createLocalFileResponse(request, filePath, mimeType) {
  const rangeHeader = String(request.headers.get('range') || '').trim();
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType || 'application/octet-stream'
  };
  if (!rangeHeader) {
    return new Response(createCancelableFileWebStream(filePath), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(total) }
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
  const unsatisfied = () => new Response(null, {
    status: 416,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${total}`
    }
  });
  if (!match || (!match[1] && !match[2]) || total <= 0) return unsatisfied();

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return unsatisfied();
    start = Math.max(0, total - suffixLength);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
      return unsatisfied();
    }
    end = Math.min(end, total - 1);
  }

  return new Response(createCancelableFileWebStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${total}`
    }
  });
}

module.exports = { createCancelableFileWebStream, createLocalFileResponse };
