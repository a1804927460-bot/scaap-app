'use strict';

const path = require('path');
const { fileURLToPath } = require('url');
const { Parser } = require('htmlparser2');

const MAX_CLIPBOARD_HTML_CHARS = 2 * 1024 * 1024;
const MAX_CLIPBOARD_TEXT_CHARS = 64 * 1024;
const MAX_CLIPBOARD_SOURCE_CHARS = 96 * 1024 * 1024;

function cleanClipboardSource(value) {
  let source = String(value || '').replace(/\u0000/g, '').trim();
  if (
    source.length >= 2 &&
    ((source.startsWith('"') && source.endsWith('"')) ||
      (source.startsWith("'") && source.endsWith("'")))
  ) {
    source = source.slice(1, -1).trim();
  }
  return source.length <= MAX_CLIPBOARD_SOURCE_CHARS ? source : '';
}

function firstSrcsetSource(value) {
  const source = cleanClipboardSource(value);
  if (!source) return '';
  const first = source.split(/\s+/)[0];
  return cleanClipboardSource(first.replace(/,$/, ''));
}

function sourceUrlFromClipboardHtml(html) {
  const match = /(?:^|\r?\n)SourceURL:([^\r\n]+)/i.exec(html);
  return cleanClipboardSource(match && match[1]);
}

function resolveClipboardSource(value, baseUrl) {
  const source = cleanClipboardSource(value);
  if (!source) return '';
  if (/^data:image\//i.test(source) || /^[a-zA-Z]:[\\/]/.test(source) || /^\\\\/.test(source)) {
    return source;
  }
  try {
    return new URL(source, baseUrl || undefined).toString();
  } catch (error) {
    return source;
  }
}

function extractHtmlImageSources(value) {
  const html = String(value || '').slice(0, MAX_CLIPBOARD_HTML_CHARS);
  if (!html) return [];
  const sources = [];
  let baseUrl = sourceUrlFromClipboardHtml(html);
  const push = (value) => {
    const source = resolveClipboardSource(value, baseUrl);
    if (source) sources.push(source);
  };
  const parser = new Parser({
    onopentag(name, attributes = {}) {
      const tag = String(name || '').toLowerCase();
      if (tag === 'base' && attributes.href) {
        baseUrl = resolveClipboardSource(attributes.href, baseUrl);
        return;
      }
      if (tag === 'img') {
        push(attributes.src || attributes['data-src'] || attributes['data-original']);
        if (attributes.srcset) push(firstSrcsetSource(attributes.srcset));
        return;
      }
      if (tag === 'source' && attributes.srcset) {
        push(firstSrcsetSource(attributes.srcset));
        return;
      }
      if (tag === 'meta') {
        const key = String(attributes.property || attributes.name || '').toLowerCase();
        if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key)) {
          push(attributes.content);
        }
      }
    }
  }, { decodeEntities: true });
  try {
    parser.write(html);
    parser.end();
  } catch (error) {
    return [];
  }
  return [...new Set(sources)];
}

function extractTextImageSources(value) {
  const text = String(value || '').slice(0, MAX_CLIPBOARD_TEXT_CHARS).replace(/\u0000/g, '');
  if (!text.trim()) return [];
  const sources = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const source = cleanClipboardSource(line);
    if (!source) continue;
    if (/^(?:data:image\/|file:\/\/|https:\/\/)/i.test(source) || /^[a-zA-Z]:[\\/]/.test(source) || /^\\\\/.test(source)) {
      sources.push(source);
    }
  }
  return [...new Set(sources)];
}

function extractClipboardImageSources({ html, text } = {}) {
  return [...new Set([
    ...extractHtmlImageSources(html),
    ...extractTextImageSources(text)
  ])];
}

function clipboardSourceToLocalPath(value) {
  const source = cleanClipboardSource(value);
  if (!source) return '';
  if (/^file:\/\//i.test(source)) {
    try { return path.normalize(fileURLToPath(source)); } catch (error) { return ''; }
  }
  if (/^[a-zA-Z]:[\\/]/.test(source) || /^\\\\/.test(source)) return path.normalize(source);
  return '';
}

function normalizeClipboardRemoteUrl(value) {
  try {
    const url = new URL(cleanClipboardSource(value));
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function isPrivateNetworkAddress(value) {
  const address = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!address) return true;
  if (address.includes(':')) {
    if (address === '::' || address === '::1') return true;
    if (/^(?:fc|fd)/.test(address) || /^fe[89ab]/.test(address) || /^ff/.test(address)) return true;
    if (address.startsWith('::ffff:')) {
      const mapped = address.slice(7);
      if (mapped.includes('.')) return isPrivateNetworkAddress(mapped);
      const groups = mapped.split(':').filter(Boolean);
      if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        const high = Number.parseInt(groups[0], 16);
        const low = Number.parseInt(groups[1], 16);
        return isPrivateNetworkAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
      return true;
    }
    return false;
  }
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

module.exports = {
  cleanClipboardSource,
  extractClipboardImageSources,
  extractHtmlImageSources,
  extractTextImageSources,
  clipboardSourceToLocalPath,
  normalizeClipboardRemoteUrl,
  isPrivateNetworkAddress
};
