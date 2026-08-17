'use strict';

const assert = require('assert');
const {
  detectChatProtocol,
  resolveChatCompletionsUrl,
  resolveGeminiUrl,
  resolveModelsUrl,
  extractModels,
  discoverChatModels,
  extractChatText,
  requestChat
} = require('../lib/ai-chat-provider');

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload)
  };
}

assert.strictEqual(extractChatText({ choices: [{ message: { content: 'hello' } }] }), 'hello');
assert.strictEqual(extractChatText({ choices: [{ delta: { content: 'streamed' } }] }), 'streamed');
assert.strictEqual(extractChatText({
  choices: [{ message: { content: '', reasoning_content: 'Doubao reasoning reply' } }]
}), 'Doubao reasoning reply');
assert.strictEqual(extractChatText({
  choices: [{ message: { content: 'DeepSeek final reply', reasoning_content: 'private reasoning' } }]
}), 'DeepSeek final reply');
assert.strictEqual(extractChatText({
  choices: [{ delta: { reasoning: [{ type: 'text', text: 'Reasoning delta reply' }] } }]
}), 'Reasoning delta reply');
assert.strictEqual(extractChatText({ data: { answer: 'fallback' } }), 'fallback');
assert.strictEqual(extractChatText({
  candidates: [{ content: { parts: [{ text: 'Gemini reply' }] } }]
}), 'Gemini reply');
assert.strictEqual(detectChatProtocol('https://generativelanguage.googleapis.com/v1beta'), 'gemini');
assert.strictEqual(detectChatProtocol('https://api.quickrouter.ai/v1beta'), 'gemini');
assert.strictEqual(detectChatProtocol('https://another-relay.example/v1beta'), 'gemini');
assert.strictEqual(detectChatProtocol('https://api.anthropic.com'), 'anthropic');
assert.strictEqual(detectChatProtocol('https://relay.example.com/v1/responses'), 'openai-responses');
assert.strictEqual(
  resolveChatCompletionsUrl('https://relay.example.com/v1/models'),
  'https://relay.example.com/v1/chat/completions'
);
assert.strictEqual(resolveModelsUrl('https://relay.example.com/v1'), 'https://relay.example.com/v1/models');
assert.deepStrictEqual(extractModels({ data: [{ id: 'gemini-2.5-flash' }, { id: 'gemini-2.5-pro' }] }), [
  'gemini-2.5-flash',
  'gemini-2.5-pro'
]);
assert.strictEqual(
  resolveGeminiUrl('https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-pro'),
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
);

(async () => {
  const discovered = await discoverChatModels(async (url, options) => {
    assert.strictEqual(url, 'https://api.quickrouter.ai/v1/models');
    assert.strictEqual(options.headers.Authorization, 'Bearer secret');
    return response({ data: [{ id: 'gemini-2.5-flash' }, { id: 'gemini-2.5-pro' }] });
  }, 'https://api.quickrouter.ai/v1', 'secret');
  assert.deepStrictEqual(discovered.models, ['gemini-2.5-flash', 'gemini-2.5-pro']);

  const nativeGeminiModels = await discoverChatModels(async (url, options) => {
    assert.strictEqual(url, 'https://api.quickrouter.ai/v1beta/models');
    assert.strictEqual(options.headers.Authorization, 'Bearer secret');
    assert.strictEqual(options.headers['x-goog-api-key'], 'secret');
    return response({ models: [{ name: 'models/gemini-2.5-flash' }] });
  }, 'https://api.quickrouter.ai/v1beta', 'secret');
  assert.deepStrictEqual(nativeGeminiModels.models, ['gemini-2.5-flash']);

  const calls = [];
  const direct = await requestChat(async (url, options) => {
    calls.push({ url, options });
    assert.strictEqual(url, 'https://api.example.com/v1/chat/completions');
    assert.strictEqual(options.headers.Authorization, 'Bearer secret');
    return response({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Direct reply' } }]
    });
  }, {
    chatEndpoint: 'https://api.example.com/v1',
    chatModel: 'gpt-4o-mini',
    resultEndpoint: 'https://api.example.com/v1/detail',
    apiKey: 'secret'
  }, {
    prompt: 'Hello',
    messages: [{ role: 'user', content: 'Hello' }]
  });
  assert.strictEqual(direct, 'Direct reply');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false
  });

  const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  await requestChat(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepStrictEqual(body.messages, [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }]);
    return response({
      choices: [{ message: { content: 'An image attachment.' } }]
    });
  }, {
    chatEndpoint: 'https://api.example.com/v1',
    chatModel: 'gemini-2.5-pro',
    apiKey: 'secret'
  }, {
    prompt: 'What is in this image?',
    messages: [{
      role: 'user',
      content: 'What is in this image?',
      images: [imageDataUrl, 'file:///not-allowed.png']
    }]
  });

  await requestChat(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /Attached file: brief\.md/);
    assert.match(body.messages[0].content, /Project deadline is Friday/);
    return response({ choices: [{ message: { content: 'Document attachment.' } }] });
  }, {
    chatEndpoint: 'https://api.example.com/v1',
    chatModel: 'gemini-3.7-flash',
    apiKey: 'secret'
  }, {
    prompt: 'Summarize the attachment',
    messages: [{
      role: 'user',
      content: 'Summarize the attachment',
      attachments: [{
        name: 'brief.md',
        mimeType: 'text/markdown',
        kind: 'text',
        sizeBytes: 32,
        readable: true,
        content: 'Project deadline is Friday.'
      }]
    }]
  });

  await requestChat(async (url) => {
    assert.strictEqual(url, 'https://api.quickrouter.ai/v1/chat/completions');
    return response({
      choices: [{ message: { content: 'QuickRouter reply' } }]
    });
  }, {
    chatEndpoint: 'https://api.quickrouter.ai',
    chatModel: 'gemini-2.5-pro',
    apiKey: 'secret'
  }, {
    prompt: 'Hello Gemini'
  });

  let callCount = 0;
  const asyncText = await requestChat(async (url) => {
    callCount += 1;
    if (callCount === 1) {
      assert.strictEqual(url, 'https://api.example.com/v1/chat/completions');
      return response({ code: 200, data: { id: 'chat-1' } });
    }
    assert.strictEqual(url, 'https://api.example.com/v1/detail?key=secret&id=chat-1');
    return response({ code: 200, data: { status: 2, answer: 'Async reply' } });
  }, {
    chatEndpoint: 'https://api.example.com/v1',
    chatModel: 'gemini-2.0-flash',
    resultEndpoint: 'https://api.example.com/v1/detail',
    apiKey: 'secret',
    pollIntervalMs: 800
  }, {
    prompt: 'Test'
  }, null, async () => {});
  assert.strictEqual(asyncText, 'Async reply');

  await assert.rejects(
    () => requestChat(async () => ({
      ok: true,
      status: 200,
      text: async () => '<!doctype html><html><body>website</body></html>'
    }), {
      chatEndpoint: 'https://api.example.com/v1',
      chatModel: 'gpt-4o-mini',
      resultEndpoint: 'https://api.example.com/v1/detail',
      apiKey: 'secret'
    }, {
      prompt: 'test'
    }),
    (error) => error && error.code === 'invalid-response' && /Base URL/.test(error.message)
  );

  await requestChat(async (url, options) => {
    assert.strictEqual(
      url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
    );
    assert.strictEqual(options.headers['x-goog-api-key'], 'secret');
    const body = JSON.parse(options.body);
    assert.deepStrictEqual(body.contents, [{
      role: 'user',
      parts: [{ text: 'Describe this' }]
    }]);
    return response({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini native reply' }] } }]
    });
  }, {
    chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    chatModel: 'gemini-2.5-pro',
    apiKey: 'secret'
  }, {
    prompt: 'Describe this'
  });

  await requestChat(async (url, options) => {
    assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
    assert.strictEqual(options.headers['x-api-key'], 'secret');
    const body = JSON.parse(options.body);
    assert.strictEqual(body.model, 'claude-3-5-sonnet');
    assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'Hello Claude' }]);
    return response({ content: [{ type: 'text', text: 'Claude reply' }] });
  }, {
    chatEndpoint: 'https://api.anthropic.com',
    chatModel: 'claude-3-5-sonnet',
    apiKey: 'secret'
  }, {
    prompt: 'Hello Claude'
  });

  await requestChat(async (url, options) => {
    assert.strictEqual(url, 'https://relay.example.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.deepStrictEqual(body.input, [{ role: 'user', content: 'Hello Responses' }]);
    return response({ output_text: 'Responses reply' });
  }, {
    chatEndpoint: 'https://relay.example.com/v1/responses',
    chatModel: 'gpt-5-mini',
    apiKey: 'secret'
  }, {
    prompt: 'Hello Responses'
  });

  process.stdout.write('AI chat provider tests passed.\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
