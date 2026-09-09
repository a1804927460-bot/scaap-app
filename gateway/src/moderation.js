import { createHash } from 'node:crypto';

const GENERATION_PATHS = new Set([
  '/v1/media/image', '/v1/media/video', '/v1/media/video/tasks/create',
  '/v1/tools/image/edit', '/v1/tools/image/expand', '/v1/tools/image/layer',
  '/v1/tools/image/topaz', '/v1/tools/image/upscale', '/v1/tools/image/erase',
  '/v1/tools/video/upscale', '/v1/tools/3d/create'
]);

export function requiresPromptModeration(method, pathname) {
  return method === 'POST' && GENERATION_PATHS.has(pathname);
}

function unavailable() {
  return Object.assign(new Error('内容审核服务暂时不可用，请稍后重试。'), {
    code: 'moderation-unavailable', status: 503, retryable: true
  });
}

export async function moderateGenerationPrompt(body, { userId, requestId, fetchImpl = fetch, env = process.env } = {}) {
  // Only screen user-controlled text, never reference bytes or chat history.
  const prompts = [body?.prompt, body?.options?.prompt, body?.negativePrompt,
    body?.options?.negativePrompt, body?.options?.promptSuffix]
    .filter((value) => value !== undefined && value !== null)
    .map(String).filter((value) => value.trim());
  const prompt = [...new Set(prompts)].join('\n');
  if (!prompt) return null;
  const key = String(env.CREEM_API_KEY || '').trim();
  const sandbox = env.CREEM_MODERATION_ENV === 'sandbox';
  if (!key || (sandbox && env.NODE_ENV === 'production') || (!sandbox && key.startsWith('creem_test_'))) {
    throw unavailable();
  }
  const externalId = createHash('sha256').update(`${userId || ''}:${requestId || ''}`).digest('hex');
  let result;
  try {
    const response = await fetchImpl(`https://${sandbox ? 'test-api' : 'api'}.creem.io/v1/moderation/prompt`, {
      method: 'POST', redirect: 'error',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, external_id: externalId }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw unavailable();
    result = await response.json();
  } catch {
    throw unavailable();
  }
  if (!['allow', 'deny', 'flag'].includes(result?.decision)) throw unavailable();
  if (result.decision === 'deny') {
    throw Object.assign(new Error('提示词未通过内容审核，请修改后重试。'), {
      code: 'prompt-rejected', status: 400
    });
  }
  return { id: result.id, decision: result.decision, units: result.usage?.units };
}
