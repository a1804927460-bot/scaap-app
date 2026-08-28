'use strict';

// Keep supplier and relay names out of renderer-visible labels and errors.
const PUBLIC_SUPPLIER_PATTERN = '(?:api\\.)?(?:atlascloud\\.ai|atlas\\s*cloud|atlascloud|302(?:\\.ai)?|ai302|quick\\s*router|topaz(?:\\s+labs)?|higgsfield|google|gemini|kling|jimeng|dreamina|minimax|doubao|seedream|seedance|hyper3d|tripo(?:3d)?|hunyuan|qwen|clipdrop|legnext|rodin|openai|anthropic|volcengine|bytedance|kwaivgi|replicate|siliconflow|aliyun|deepseek)';
const PUBLIC_SUPPLIER_RE = new RegExp(`\\b${PUBLIC_SUPPLIER_PATTERN}\\b`, 'gi');
const PUBLIC_MODEL_SUPPLIER_PATTERN = '(?:api\\.)?(?:atlascloud\\.ai|atlas\\s*cloud|atlascloud|302\\.ai|ai302|quick\\s*router|topaz(?:\\s+labs)?|higgsfield)';
const PUBLIC_MODEL_SUPPLIER_RE = new RegExp(`\\b${PUBLIC_MODEL_SUPPLIER_PATTERN}\\b`, 'gi');
const PUBLIC_MODEL_SUPPLIER_SUFFIX_RE = new RegExp(`\\s*[\\(\\[\\{]\\s*${PUBLIC_MODEL_SUPPLIER_PATTERN}\\s*[\\)\\]\\}]`, 'gi');
const PUBLIC_SUPPLIER_DOMAIN_RE = /https?:\/\/[^\s/]*(?:atlascloud\.ai|302\.ai|quickrouter\.ai|topazlabs\.com|higgsfield\.ai|googleapis\.com|generativelanguage\.googleapis\.com|klingai\.com|jimeng\.com)[^\s]*/gi;

function compactPublicText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function publicModelLabel(value, fallback = 'AI model') {
  let text = compactPublicText(value);
  if (!text) return fallback;
  if (/^(?:google|gemini|minimax|kling|jimeng|dreamina)$/i.test(text)) return fallback;
  text = text
    .replace(PUBLIC_MODEL_SUPPLIER_SUFFIX_RE, '')
    .replace(PUBLIC_SUPPLIER_DOMAIN_RE, '')
    .replace(PUBLIC_MODEL_SUPPLIER_RE, '')
    .replace(/^[\s._|:·•-]+|[\s._|:·•-]+$/g, '')
    .replace(/\s*([|·•])\s*$/g, '')
    .replace(/\s*[-:]\s*$/g, '')
    .replace(/\(\s*[\)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

function publicAiErrorMessage(value, fallback = 'The AI service could not complete this request.') {
  let text = compactPublicText(value);
  if (!text) return fallback;
  text = text
    .replace(PUBLIC_SUPPLIER_DOMAIN_RE, 'AI service')
    .replace(PUBLIC_SUPPLIER_RE, 'AI service')
    .replace(/\b(?:the\s+)?AI service\s+tool service\b/gi, 'The AI tool service')
    .replace(/\bAI service\s+API\b/gi, 'AI service')
    .replace(/\bAI service(?:\s+AI service)+\b/gi, 'AI service')
    .replace(/\b(?:the\s+)?AI service(?:\s+service)+\b/gi, 'AI service')
    .replace(/\b(?:task|request|prediction|generation)[-_ ]?id\s*[:=]\s*[A-Za-z0-9._~-]+/gi, '')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '')
    .replace(/\b(?:Bearer\s+)?(?:sk|sb_secret|ghp|github_pat)[-_A-Za-z0-9]{8,}\b/gi, '')
    .replace(/\ba\s+AI\b/g, 'an AI')
    .replace(/\s*\(?HTTP\s+\d{3}\)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

window.publicModelLabel = publicModelLabel;
window.publicAiErrorMessage = publicAiErrorMessage;
