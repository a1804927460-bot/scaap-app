'use strict';

const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';

function normalizeEndpoint(value, fallback = '') {
  const text = String(value || fallback || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch (err) {
    return '';
  }
}

function normalizeChatModel(value) {
  const text = String(value || '').trim();
  return text || DEFAULT_CHAT_MODEL;
}

function formatAuthorization(apiKey) {
  const text = String(apiKey || '').trim();
  if (!text) return '';
  return /^Bearer\s+/i.test(text) ? text : `Bearer ${text}`;
}

function withQuery(endpoint, values) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function resolveChatCompletionsUrl(endpoint) {
  const url = new URL(endpoint);
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    let pathname = url.pathname
      .replace(/\/(?:responses|models|embeddings)\/?$/i, '')
      .replace(/\/$/, '');
    if (!pathname || pathname === '/') pathname = '/v1';
    url.pathname = `${pathname}/chat/completions`;
  }
  url.hash = '';
  return url.toString();
}

function detectChatProtocol(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint || '').trim());
  } catch (err) {
    return 'openai-chat';
  }
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (
    host === 'generativelanguage.googleapis.com' ||
    /^\/v1beta(?:\/|$)/.test(pathname) ||
    /:generatecontent\/?$/.test(pathname) ||
    /:streamgeneratecontent\/?$/.test(pathname)
  ) {
    return 'gemini';
  }
  if (host === 'api.anthropic.com' || /\/v1\/messages\/?$/.test(pathname)) {
    return 'anthropic';
  }
  if (/\/responses\/?$/.test(pathname)) return 'openai-responses';
  return 'openai-chat';
}

function resolveResponsesUrl(endpoint) {
  const url = new URL(endpoint);
  if (!/\/responses\/?$/i.test(url.pathname)) {
    let pathname = url.pathname
      .replace(/\/(?:chat\/completions|models|embeddings)\/?$/i, '')
      .replace(/\/$/, '');
    if (!pathname || pathname === '/') pathname = '/v1';
    url.pathname = `${pathname}/responses`;
  }
  url.hash = '';
  return url.toString();
}

function resolveGeminiUrl(endpoint, model) {
  const url = new URL(endpoint);
  let pathname = url.pathname.replace(/\/$/, '');
  if (/:streamgeneratecontent$/i.test(pathname)) {
    pathname = pathname.replace(/:streamgeneratecontent$/i, ':generateContent');
  } else if (!/:generatecontent$/i.test(pathname)) {
    if (/\/models\/[^/]+$/i.test(pathname)) {
      pathname += ':generateContent';
    } else {
      if (!pathname) pathname = '/v1beta';
      if (/\/models$/i.test(pathname)) {
        pathname += `/${encodeURIComponent(model)}`;
      } else {
        pathname += `/models/${encodeURIComponent(model)}`;
      }
      pathname += ':generateContent';
    }
  }
  url.pathname = pathname;
  url.hash = '';
  return url.toString();
}

function resolveAnthropicMessagesUrl(endpoint) {
  const url = new URL(endpoint);
  if (!/\/v1\/messages\/?$/i.test(url.pathname)) {
    let pathname = url.pathname.replace(/\/$/, '');
    if (!pathname) pathname = '/v1';
    if (/\/v1$/i.test(pathname)) pathname += '/messages';
    else pathname += '/v1/messages';
    url.pathname = pathname;
  }
  url.hash = '';
  return url.toString();
}

function resolveModelsUrl(endpoint) {
  const url = new URL(endpoint);
  let pathname = url.pathname
    .replace(/\/(?:chat\/completions|responses|messages)\/?$/i, '')
    .replace(/\/$/, '');
  if (!pathname || pathname === '/') pathname = '/v1';
  if (/\/models\/[^/]+$/i.test(pathname)) pathname = pathname.replace(/\/[^/]+$/, '');
  if (!/\/models$/i.test(pathname)) pathname += '/models';
  url.pathname = pathname;
  url.hash = '';
  return url.toString();
}

function extractModels(payload) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload && payload.data)
      ? payload.data
      : Array.isArray(payload && payload.models)
        ? payload.models
        : Array.isArray(payload && payload.data && payload.data.models)
          ? payload.data.models
          : [];
  return source
    .map((item) => String(item && (item.id || item.name || item.model) || item || '').trim())
    .map((model) => model.replace(/^models\//i, ''))
    .filter(Boolean)
    .filter((model, index, list) => list.indexOf(model) === index)
    .slice(0, 50);
}

async function discoverChatModels(fetchImpl, endpoint, apiKey) {
  const url = new URL(endpoint);
  const protocol = detectChatProtocol(endpoint);
  const modelsUrl = protocol === 'gemini'
    ? (() => {
      let pathname = url.pathname.replace(/\/(?:models\/[^/]+)?(?::(?:stream)?generatecontent)?\/?$/i, '');
      if (!pathname) pathname = '/v1beta';
      if (!/\/models$/i.test(pathname)) pathname += '/models';
      url.pathname = pathname;
      url.search = '';
      return url.toString();
    })()
    : resolveModelsUrl(endpoint);
  const officialGemini = protocol === 'gemini' &&
    new URL(modelsUrl).hostname.toLowerCase() === 'generativelanguage.googleapis.com';
  const response = await fetchImpl(
    officialGemini ? withQuery(modelsUrl, { key: apiKey }) : modelsUrl,
    {
    headers: {
      ...(protocol === 'gemini'
        ? officialGemini
          ? { 'x-goog-api-key': apiKey }
          : { 'x-goog-api-key': apiKey, Authorization: formatAuthorization(apiKey) }
        : { Authorization: formatAuthorization(apiKey) }),
      Accept: 'application/json'
    }
    }
  );
  const payload = await readJsonResponse(response, '无法读取模型列表', modelsUrl);
  const models = extractModels(payload);
  if (!models.length) {
    const error = new Error('接口没有返回可用模型列表。');
    error.code = 'empty-model-list';
    throw error;
  }
  return { models, protocol };
}

function isLikelyHtml(text) {
  return /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(String(text || ''));
}

async function readJsonResponse(response, fallbackMessage, endpoint) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (err) {
    const error = new Error(
      isLikelyHtml(text)
        ? `接口返回了网页而不是 JSON。当前地址：${endpoint || '未填写'}。请填写 API Base URL 或具体请求 URL，不要填写服务商网站首页。`
        : fallbackMessage
    );
    error.code = 'invalid-response';
    throw error;
  }

  if (!response.ok) {
    const apiMessage = payload && (payload.msg || payload.message || (payload.error && payload.error.message));
    const error = new Error(apiMessage || `${fallbackMessage} (HTTP ${response.status})`);
    error.code = 'api-error';
    error.status = response.status;
    throw error;
  }

  return payload;
}

function extractTextFromAny(value, seen = new Set(), depth = 0) {
  if (depth > 8 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || /^https?:\/\//i.test(text)) return '';
    return text;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractTextFromAny(item, seen, depth + 1);
      if (text) return text;
    }
    return '';
  }
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const priorityKeys = [
    'content', 'parts', 'candidates', 'text', 'output_text',
    'answer', 'reply', 'result', 'output', 'completion', 'message', 'data',
    'reasoning_content', 'reasoningContent', 'reasoning', 'thinking'
  ];
  for (const key of priorityKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const text = extractTextFromAny(value[key], seen, depth + 1);
    if (text) return text;
  }
  return '';
}

function extractChatText(value) {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      const text = extractTextFromAny([
        choice && choice.message && choice.message.content,
        choice && choice.delta && choice.delta.content,
        choice && choice.text,
        choice && choice.message && choice.message.reasoning_content,
        choice && choice.message && choice.message.reasoningContent,
        choice && choice.message && choice.message.reasoning,
        choice && choice.message && choice.message.thinking,
        choice && choice.delta && choice.delta.reasoning_content,
        choice && choice.delta && choice.delta.reasoningContent,
        choice && choice.delta && choice.delta.reasoning
      ]);
      if (text) return text;
    }
  }
  return extractTextFromAny([
    value.output_text,
    value.candidates,
    value.content,
    value.text,
    value.answer,
    value.result,
    value.message,
    value.data,
    value.reasoning_content,
    value.reasoningContent,
    value.reasoning,
    value.thinking
  ]);
}

function extractChatUsage(value) {
  const usage = value && typeof value === 'object'
    ? (value.usageMetadata || value.usage || value.token_usage || value.tokenUsage)
    : null;
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Math.max(0, Math.round(Number(
    usage.promptTokenCount ?? usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens
  ) || 0));
  const outputTokens = Math.max(0, Math.round(Number(
    usage.candidatesTokenCount ?? usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens
  ) || 0));
  const totalTokens = Math.max(inputTokens + outputTokens, Math.round(Number(
    usage.totalTokenCount ?? usage.total_tokens ?? usage.totalTokens
  ) || 0));
  return inputTokens || outputTokens || totalTokens
    ? { inputTokens, outputTokens, totalTokens }
    : null;
}

function extractTaskId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.data && typeof payload.data === 'object' && payload.data.id) {
    return String(payload.data.id);
  }
  return payload.id ? String(payload.id) : '';
}

function normalizeConversation(prompt, messages) {
  const source = Array.isArray(messages) ? messages : [];
  let remainingAttachmentCharacters = 120_000;
  const mapped = source.slice(-20).map((message) => {
    const role = message && message.role === 'assistant'
      ? 'assistant'
      : message && message.role === 'system'
        ? 'system'
        : 'user';
    const text = String(message && message.content || '').slice(0, 12000);
    const images = role === 'user' && Array.isArray(message && message.images)
      ? message.images
        .map((image) => String(image || '').trim())
        .filter((image) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(image))
        .slice(0, 4)
      : [];
    const attachments = role === 'user' && Array.isArray(message && message.attachments)
      ? message.attachments.slice(0, 8).map((attachment) => {
        const content = String(attachment && attachment.content || '')
          .slice(0, Math.min(48_000, Math.max(0, remainingAttachmentCharacters)));
        remainingAttachmentCharacters -= content.length;
        return {
          name: String(attachment && attachment.name || 'attachment').slice(0, 120),
          mimeType: String(attachment && attachment.mimeType || 'application/octet-stream').slice(0, 120),
          kind: String(attachment && attachment.kind || 'file').slice(0, 24),
          sizeBytes: Math.max(0, Number(attachment && attachment.sizeBytes) || 0),
          readable: attachment && attachment.readable === true,
          truncated: attachment && attachment.truncated === true,
          content
        };
      })
      : [];
    return { role, text, images, attachments };
  });

  if (mapped.length) return mapped;
  const text = String(prompt || '').trim();
  return text ? [{ role: 'user', text, images: [], attachments: [] }] : [];
}

function messageTextWithAttachments(message) {
  if (!message.attachments.length) return message.text;
  const blocks = message.attachments.map((attachment) => {
    const header = [
      `Attached file: ${attachment.name}`,
      `Type: ${attachment.mimeType || attachment.kind}`,
      `Size: ${attachment.sizeBytes} bytes`,
      `Content extracted: ${attachment.readable ? 'yes' : 'no'}`
    ];
    if (attachment.truncated) header.push('Note: the extracted content was truncated.');
    if (attachment.content) header.push('', attachment.content);
    else header.push('', '[No readable text was available. Do not claim to have inspected binary contents.]');
    return `[${header.join('\n')}]`;
  });
  return [message.text, ...blocks].filter(Boolean).join('\n\n');
}

function buildMessages(prompt, messages) {
  return normalizeConversation(prompt, messages).map((message) => {
    const text = messageTextWithAttachments(message);
    return {
      role: message.role,
      content: message.images.length
        ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...message.images.map((image) => ({ type: 'image_url', image_url: { url: image } }))
        ]
        : text
    };
  });
}

function parseInlineImage(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(String(dataUrl || ''));
  return match ? { mimeType: match[1], data: match[2] } : null;
}

function buildGeminiBody(prompt, messages) {
  const conversation = normalizeConversation(prompt, messages);
  const systemText = conversation
    .filter((message) => message.role === 'system')
    .map((message) => message.text)
    .filter(Boolean)
    .join('\n\n');
  const contents = conversation
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(messageTextWithAttachments(message) ? [{ text: messageTextWithAttachments(message) }] : []),
        ...message.images.map(parseInlineImage).filter(Boolean).map((image) => ({
          inlineData: {
            mimeType: image.mimeType,
            data: image.data
          }
        }))
      ]
    }))
    .filter((message) => message.parts.length);
  return {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents
  };
}

function buildAnthropicBody(model, prompt, messages) {
  const conversation = normalizeConversation(prompt, messages);
  const system = conversation
    .filter((message) => message.role === 'system')
    .map((message) => message.text)
    .filter(Boolean)
    .join('\n\n');
  const anthropicMessages = conversation
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const text = messageTextWithAttachments(message);
      const imageBlocks = message.images
        .map(parseInlineImage)
        .filter(Boolean)
        .map((image) => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType,
            data: image.data
          }
        }));
      return {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: imageBlocks.length
          ? [
            ...(text ? [{ type: 'text', text }] : []),
            ...imageBlocks
          ]
          : text
      };
    })
    .filter((message) => (
      typeof message.content === 'string'
        ? message.content.trim()
        : message.content.length
    ));
  return {
    model,
    max_tokens: 4096,
    ...(system ? { system } : {}),
    messages: anthropicMessages
  };
}

function buildResponsesInput(prompt, messages) {
  return normalizeConversation(prompt, messages).map((message) => {
    const text = messageTextWithAttachments(message);
    return {
      role: message.role,
      content: message.images.length
        ? [
          ...(text ? [{ type: 'input_text', text }] : []),
          ...message.images.map((image) => ({ type: 'input_image', image_url: image }))
        ]
        : text
    };
  });
}

async function pollChatTask(fetchImpl, config, taskId, signal, sleepImpl) {
  const sleep = sleepImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = Date.now();
  while (Date.now() - startedAt < config.timeoutMs) {
    await sleep(config.pollIntervalMs);
    if (signal && signal.aborted) {
      const error = new Error('AI 对话已取消。');
      error.name = 'AbortError';
      throw error;
    }
    const response = await fetchImpl(withQuery(config.resultEndpoint, {
      key: config.apiKey,
      id: taskId
    }), {
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        Accept: 'application/json'
      },
      signal
    });
    const payload = await readJsonResponse(response, '无法读取 AI 对话结果', config.resultEndpoint);
    const status = Number(payload && payload.data && payload.data.status);
    if (status === 3) {
      const error = new Error(
        (payload.data && payload.data.message) ||
        payload.msg ||
        'AI 对话任务失败。'
      );
      error.code = 'generation-failed';
      throw error;
    }
    const text = extractChatText(payload);
    if (status === 2 || (Number.isNaN(status) && text)) {
      if (text) return text;
      const error = new Error('AI 对话已完成，但没有返回文本。');
      error.code = 'empty-response';
      throw error;
    }
  }
  const error = new Error('AI 对话等待超时，请稍后重试。');
  error.code = 'timeout';
  throw error;
}

async function requestChat(fetchImpl, rawConfig, request, signal, sleepImpl) {
  const config = {
    chatEndpoint: normalizeEndpoint(rawConfig.chatEndpoint),
    resultEndpoint: normalizeEndpoint(rawConfig.resultEndpoint),
    chatModel: normalizeChatModel(rawConfig.chatModel),
    apiKey: String(rawConfig.apiKey || '').trim(),
    pollIntervalMs: Math.max(800, Number(rawConfig.pollIntervalMs) || 2500),
    timeoutMs: Math.max(10000, Number(rawConfig.timeoutMs) || 10 * 60 * 1000)
  };

  if (!config.chatEndpoint) {
    const error = new Error('请先在设置里填写对话 API 的 Base URL 或完整请求 URL。');
    error.code = 'missing-chat-endpoint';
    throw error;
  }
  if (!config.apiKey) {
    const error = new Error('请先在设置里保存 API Key。');
    error.code = 'missing-api-key';
    throw error;
  }

  const prompt = String(request && request.prompt || '').trim();
  const requestMessages = request && request.messages;
  const protocol = detectChatProtocol(config.chatEndpoint);
  let endpoint;
  let body;
  let headers;

  if (protocol === 'gemini') {
    endpoint = resolveGeminiUrl(config.chatEndpoint, config.chatModel);
    body = buildGeminiBody(prompt, requestMessages);
    body.generationConfig = { ...(body.generationConfig || {}), maxOutputTokens: 4096 };
    const geminiHost = new URL(endpoint).hostname.toLowerCase();
    const officialGemini = geminiHost === 'generativelanguage.googleapis.com';
    headers = {
      ...(officialGemini
        ? { 'x-goog-api-key': config.apiKey }
        : {
          Authorization: formatAuthorization(config.apiKey),
          'x-goog-api-key': config.apiKey
        }),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  } else if (protocol === 'anthropic') {
    endpoint = resolveAnthropicMessagesUrl(config.chatEndpoint);
    body = buildAnthropicBody(config.chatModel, prompt, requestMessages);
    const officialAnthropic = new URL(endpoint).hostname.toLowerCase() === 'api.anthropic.com';
    headers = {
      ...(officialAnthropic
        ? { 'x-api-key': config.apiKey }
        : { Authorization: formatAuthorization(config.apiKey) }),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  } else if (protocol === 'openai-responses') {
    endpoint = resolveResponsesUrl(config.chatEndpoint);
    body = {
      model: config.chatModel,
      input: buildResponsesInput(prompt, requestMessages),
      max_output_tokens: 4096,
      stream: false
    };
    headers = {
      Authorization: formatAuthorization(config.apiKey),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  } else {
    endpoint = resolveChatCompletionsUrl(config.chatEndpoint);
    body = {
      model: config.chatModel,
      messages: buildMessages(prompt, requestMessages),
      max_tokens: 4096,
      stream: false
    };
    headers = {
      Authorization: formatAuthorization(config.apiKey),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  const payload = await readJsonResponse(response, 'AI 对话请求失败', endpoint);
  const directText = extractChatText(payload);
  if (directText) {
    return rawConfig && rawConfig.returnUsage === true
      ? { text: directText, usage: extractChatUsage(payload) }
      : directText;
  }

  const taskId = extractTaskId(payload);
  if (taskId && config.resultEndpoint) {
    return pollChatTask(fetchImpl, config, taskId, signal, sleepImpl);
  }

  const error = new Error('接口没有返回聊天文本。');
  error.code = 'empty-response';
  throw error;
}

module.exports = {
  detectChatProtocol,
  resolveChatCompletionsUrl,
  resolveGeminiUrl,
  resolveAnthropicMessagesUrl,
  extractChatText,
  extractChatUsage,
  extractTaskId,
  buildMessages,
  buildGeminiBody,
  buildAnthropicBody,
  buildResponsesInput,
  messageTextWithAttachments,
  pollChatTask,
  resolveModelsUrl,
  extractModels,
  discoverChatModels,
  requestChat
};
