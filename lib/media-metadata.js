'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const activeMetadataProcesses = new Set();

function shutdownProcesses() {
  for (const child of activeMetadataProcesses) {
    try { child.kill('SIGKILL'); } catch (error) {}
  }
  activeMetadataProcesses.clear();
}

function resolveFfmpegBinary() {
  try {
    const binary = require('ffmpeg-static');
    const unpacked = binary && binary.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`
    );
    if (unpacked !== binary && fs.existsSync(unpacked)) return unpacked;
    return binary && fs.existsSync(binary) ? binary : null;
  } catch (error) {
    return null;
  }
}

function parseDurationSeconds(value) {
  const match = String(value || '').match(/(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/**
 * Parses the header printed by `ffmpeg -i`.  ffmpeg-static does not bundle a
 * separate ffprobe executable, but this header contains the same display
 * dimensions and is read without decoding the whole movie.
 */
function parseFfmpegVideoMetadata(value) {
  const text = String(value || '');
  const videoLines = text.split(/\r?\n/).filter((line) => /Video:/i.test(line));
  let dimensions = null;
  for (const line of videoLines) {
    const matches = [...line.matchAll(/(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,\[]|$)/g)];
    const candidate = matches.find((entry) => {
      const width = Number(entry[1]);
      const height = Number(entry[2]);
      return width >= 16 && height >= 16 && width <= 32768 && height <= 32768;
    });
    if (candidate) {
      dimensions = { width: Number(candidate[1]), height: Number(candidate[2]) };
      break;
    }
  }
  if (!dimensions) return null;

  const videoText = videoLines.join('\n');
  const rotationMatch = text.match(/displaymatrix:\s*rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/i)
    || text.match(/\brotate\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const rotation = rotationMatch ? Number(rotationMatch[1]) : 0;
  const normalizedQuarterTurns = Number.isFinite(rotation)
    ? Math.abs(Math.round(rotation / 90)) % 2
    : 0;
  const durationMatch = text.match(/Duration:\s*([^,\r\n]+)/i);
  const duration = durationMatch ? parseDurationSeconds(durationMatch[1]) : null;
  const sampleAspectRatioMatch = videoText.match(/\bSAR\s+(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/i);
  const displayAspectRatioMatch = videoText.match(/\bDAR\s+(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/i);
  let displayWidth = dimensions.width;
  let displayHeight = dimensions.height;
  if (sampleAspectRatioMatch) {
    const sar = Number(sampleAspectRatioMatch[1]) / Number(sampleAspectRatioMatch[2]);
    if (Number.isFinite(sar) && sar > 0) displayWidth = Math.round(displayWidth * sar);
  } else if (displayAspectRatioMatch) {
    const dar = Number(displayAspectRatioMatch[1]) / Number(displayAspectRatioMatch[2]);
    if (Number.isFinite(dar) && dar > 0) displayWidth = Math.round(displayHeight * dar);
  }
  const sourceWidth = normalizedQuarterTurns ? displayHeight : displayWidth;
  const sourceHeight = normalizedQuarterTurns ? displayWidth : displayHeight;

  return {
    sourceWidth,
    sourceHeight,
    hasAudio: /(?:^|\n)\s*Stream[^\n]*Audio:/i.test(text),
    ...(duration !== null ? { sourceDuration: duration } : {})
  };
}

function probeVideoMetadata(filePath, options = {}) {
  const ffmpegPath = options.ffmpegPath || resolveFfmpegBinary();
  const spawnImpl = options.spawnImpl || spawn;
  if (!ffmpegPath || !filePath) return Promise.resolve(null);

  return new Promise((resolve) => {
    let child;
    try {
      // Supplying no output makes ffmpeg stop immediately after reading the
      // container headers.  Exit code 1 is expected; the metadata is on
      // stderr and is still valid.
      child = spawnImpl(ffmpegPath, ['-hide_banner', '-i', filePath], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
      activeMetadataProcesses.add(child);
    } catch (error) {
      resolve(null);
      return;
    }

    let stderr = '';
    let settled = false;
    const finish = (metadata = null) => {
      if (settled) return;
      settled = true;
      activeMetadataProcesses.delete(child);
      clearTimeout(timer);
      resolve(metadata);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (error) {}
      finish(null);
    }, Math.max(2_000, Number(options.timeoutMs) || 15_000));

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 512 * 1024) stderr += chunk.toString();
      });
    }
    child.on('error', () => finish(null));
    child.on('close', () => finish(parseFfmpegVideoMetadata(stderr)));
  });
}

module.exports = {
  parseFfmpegVideoMetadata,
  probeVideoMetadata,
  resolveFfmpegBinary,
  shutdownProcesses
};
