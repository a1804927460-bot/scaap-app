'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {createLocalFileResponse} = require('./local-file-response');
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
function directorAssetPath(root, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'messs-director:' || parsed.hostname !== 'app') return null;
  const pathname = decodeURIComponent(parsed.pathname);
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) return null;
  const resolved = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root,resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null;
}
function createDirectorResponse(root, request) {
  try {
    const file = directorAssetPath(root,request.url);
    if (!file || !fs.statSync(file).isFile()) return new Response('Not found',{status:404});
    const response = createLocalFileResponse(request,file,TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob: data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
    response.headers.set('X-Content-Type-Options','nosniff');
    return response;
  } catch { return new Response('Not found',{status:404}); }
}
module.exports = {directorAssetPath,createDirectorResponse};
