'use strict';

// These names may appear in upstream responses or legacy provider settings.
// They are implementation details and must never become part of the client UI.
const SUPPLIER_PATTERN = '(?:api\\.)?(?:atlascloud\\.ai|atlas\\s*cloud|atlascloud|302(?:\\.ai)?|ai302|quick\\s*router|topaz(?:\\s+labs)?|higgsfield|google|gemini|kling|jimeng|dreamina|minimax|doubao|seedream|seedance|hyper3d|tripo(?:3d)?|hunyuan|qwen|clipdrop|legnext|rodin|openai|anthropic|volcengine|bytedance|kwaivgi|replicate|siliconflow|aliyun|deepseek)';
const SUPPLIER_RE = new RegExp(`\\b${SUPPLIER_PATTERN}\\b`, 'gi');
const MODEL_SUPPLIER_PATTERN = '(?:api\\.)?(?:atlascloud\\.ai|atlas\\s*cloud|atlascloud|302\\.ai|ai302|quick\\s*router|topaz(?:\\s+labs)?|higgsfield)';
const MODEL_SUPPLIER_RE = new RegExp(`\\b${MODEL_SUPPLIER_PATTERN}\\b`, 'gi');
const MODEL_SUPPLIER_SUFFIX_RE = new RegExp(`\\s*[\\(\\[\\{]\\s*${MODEL_SUPPLIER_PATTERN}\\s*[\\)\\]\\}]`, 'gi');
const SUPPLIER_DOMAIN_RE = /https?:\/\/[^\s/]*(?:atlascloud\.ai|302\.ai|quickrouter\.ai|topazlabs\.com|higgsfield\.ai|googleapis\.com|generativelanguage\.googleapis\.com|klingai\.com|jimeng\.com)[^\s]*/gi;

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizePublicModelLabel(value, fallback = 'AI model') {
  let text = compact(value);
  if (!text) return fallback;
  if (/^(?:google|gemini|minimax|jimeng|dreamina)$/i.test(text)) return fallback;
  text = text
    .replace(MODEL_SUPPLIER_SUFFIX_RE, '')
    .replace(SUPPLIER_DOMAIN_RE, '')
    .replace(MODEL_SUPPLIER_RE, '')
    .replace(/^[\s._|:·•-]+|[\s._|:·•-]+$/g, '')
    .replace(/\s*([|·•])\s*$/g, '')
    .replace(/\s*[-:]\s*$/g, '')
    .replace(/\(\s*[\)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

function sanitizePublicAiError(value, fallback = 'The AI service could not complete this request.') {
  let text = compact(value);
  if (!text) return fallback;
  text = text
    .replace(SUPPLIER_DOMAIN_RE, 'AI service')
    .replace(SUPPLIER_RE, 'AI service')
    .replace(/\b(?:the\s+)?AI service\s+tool service\b/gi, 'The AI tool service')
    .replace(/\bAI service\s+API\b/gi, 'AI service')
    .replace(/\bAI service(?:\s+AI service)+\b/gi, 'AI service')
    .replace(/\b(?:the\s+)?AI service(?:\s+service)+\b/gi, 'AI service')
    .replace(/\ba\s+AI\b/g, 'an AI')
    .replace(/\s*\(?HTTP\s+\d{3}\)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

module.exports = {
  sanitizePublicModelLabel,
  sanitizePublicAiError
};
