'use strict';

const { createParser } = require('eventsource-parser');

function streamError(message, code = 'chat-stream-interrupted') {
  return Object.assign(new Error(message), { code, providerTaskAccepted: true });
}

async function readEvents(response, onEvent, signal) {
  if (!response.body?.getReader) throw streamError('Missing chat response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let events = [], bytes = 0;
  const parser = createParser({
    maxBufferSize: 1024 * 1024,
    onEvent: event => events.push(event),
    onError: error => { if (error.type === 'max-buffer-size-exceeded') throw error; }
  });
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      bytes += value?.byteLength || 0;
      if (bytes > 8 * 1024 * 1024) throw streamError('Chat stream exceeds size limit.');
      parser.feed(done ? decoder.decode() : decoder.decode(value, { stream: true }));
      const batch = events;
      events = [];
      for (const event of batch) {
        if (await onEvent(event) === false) return;
      }
      if (done) return;
    }
  } catch (error) {
    error.providerTaskAccepted = true;
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readChatCompletionStream(response, onDelta, signal) {
  let text = '', usage, finishReason, complete = false;
  await readEvents(response, async ({ data }) => {
    if (data === '[DONE]') {
      complete = true;
      return false;
    }
    let payload;
    try { payload = JSON.parse(data); } catch { throw streamError('Invalid chat stream event.'); }
    if (payload.error) throw streamError('The upstream chat stream failed.');
    if (payload.usage) usage = payload.usage;
    const choice = payload.choices?.find(entry => entry.index === 0) || payload.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta?.content;
    // Do not expose model reasoning or provider-native tool arguments.
    if (typeof delta === 'string' && delta) {
      text += delta;
      if (text.length > 100000) throw streamError('Chat output exceeds size limit.', 'output-too-large');
      await onDelta(delta);
    }
  }, signal);
  if ((!complete && !finishReason) || !text) throw streamError('The chat stream ended without a complete answer.');
  if (finishReason === 'content_filter') throw streamError('The chat response was blocked.', 'content-policy-violation');
  return { choices: [{ message: { content: text }, finish_reason: finishReason }], usage };
}

async function readGatewayChatStream(response, onDelta, signal) {
  let result;
  await readEvents(response, async ({ event, data }) => {
    let payload;
    try { payload = JSON.parse(data); } catch { throw streamError('Invalid gateway stream event.'); }
    if (event === 'delta') {
      if (typeof payload.text !== 'string') throw streamError('Invalid chat delta.');
      await onDelta(payload.text);
    } else if (event === 'done') {
      if (typeof payload.text !== 'string' || payload.text.length > 100000) throw streamError('Invalid chat completion.');
      result = payload;
      return false;
    } else if (event === 'error') {
      throw Object.assign(streamError('The chat response could not be completed.'), {
        code: String(payload.code || 'chat-response-unavailable'), status: Number(payload.status) || 502
      });
    }
  }, signal);
  if (!result) throw streamError('The gateway stream ended before completion.');
  return result;
}

// Artifact/tool bodies remain private until the existing complete-output
// parser validates them. Even a '<messs-' tag split across packets is withheld.
function createChatPreview(onText) {
  let text = '', blocked = false;
  return delta => {
    if (blocked) return;
    const boundary = delta.indexOf('<');
    if (boundary >= 0) blocked = true;
    text += boundary >= 0 ? delta.slice(0, boundary) : delta;
    if (text.length > 100000) throw streamError('Chat preview exceeds size limit.');
    if (text.trim()) onText(text);
  };
}

module.exports = { readEvents, readChatCompletionStream, readGatewayChatStream, createChatPreview };
