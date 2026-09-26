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

function brandedPublicModelLabel(value) {
  const key = compactPublicText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const labels = {
    nanobananapro: 'Mess NPro',
    nanobanapro: 'Mess NPro',
    nanobanana2: 'Mess N2',
    gptimage2: 'Mess Image2',
    gptimage25: 'Mess Image2.5',
    midjourneyv82: 'Mess Jennie',
    midjoureyv82: 'Mess Jennie'
  };
  return labels[key] || value;
}

function publicModelLabel(value, fallback = 'AI model') {
  let text = compactPublicText(value);
  if (!text) return fallback;
  if (/^(?:google|gemini|minimax|jimeng|dreamina)$/i.test(text)) return fallback;
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
  return brandedPublicModelLabel(text) || fallback;
}

function publicAiErrorMessage(value, fallback = 'The AI service could not complete this request.', reason = '') {
  let text = compactPublicText(value);
  const language = String(
    typeof document !== 'undefined' && document.documentElement
      ? document.documentElement.dataset.language || 'en'
      : 'en'
  );
  const localized = (en, zh, ja) => language === 'zh' ? zh : language === 'ja' ? ja : en;
  if (reason === 'provider-request-failed' || /^The generation request was not accepted\./i.test(text)) {
    const message = localized(
      'The generation request was not accepted. Check the reference files and settings, then try again.',
      '生成请求未被接受，请检查参考素材和参数后重试。',
      '生成リクエストが受け付けられませんでした。参照ファイルと設定を確認して再試行してください。'
    );
    // Do not infer billing settlement from a rejected request alone.
    return /\bNo points were charged\b/i.test(text)
      ? message + localized(' No points were charged.', '本次未扣积分。', ' ポイントは消費されませんでした。')
      : message;
  }
  if (!text) return fallback;
  if (/does not support (?:this|the selected) aspect ratio|invalid[-_ ]aspect[-_ ]ratio/i.test(text)) {
    return localized(
      'This aspect ratio is unavailable for the current generation mode. A supported ratio has been selected; please try again.',
      '当前生成模式不支持这个画面比例，已自动切换为可用比例，请重试。',
      '現在の生成モードではこの縦横比を使用できません。対応する比率に変更しました。もう一度お試しください。'
    );
  }
  if (/does not support (?:this|the selected) resolution|invalid[-_ ]resolution/i.test(text)) {
    return localized(
      'This resolution is unavailable for the current generation mode. Choose another resolution and try again.',
      '当前生成模式不支持这个分辨率，请更换分辨率后重试。',
      '現在の生成モードではこの解像度を使用できません。別の解像度を選択してください。'
    );
  }
  if (/does not support (?:this|the selected) duration|invalid[-_ ]duration/i.test(text)) {
    return localized(
      'This duration is unavailable for the current generation mode. Choose another duration and try again.',
      '当前生成模式不支持这个时长，请更换时长后重试。',
      '現在の生成モードではこの長さを使用できません。別の長さを選択してください。'
    );
  }
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
