import crypto from 'node:crypto';
import pricing from '../../lib/chat-cost-pricing.js';
import catalog from '../../lib/chat-rates.js';

const billingError = (code, status = 503) => Object.assign(new Error(code), { code, status });

export function chatRate(provider, model) {
  // An identical model name on a different upstream does not imply an identical cost.
  const host = new URL(provider.endpoint).hostname;
  const rate = catalog.CHAT_RATES[model];
  if (!rate || !(host === 'aireiter.com' || host.endsWith('.aireiter.com'))) {
    throw billingError('chat-pricing-unavailable');
  }
  return rate;
}

export function chatBudget(request, usage, rate, turns) {
  let images = 0;
  const messages = request.messages?.map(message => {
    images += Array.isArray(message.images) ? message.images.length : 0;
    return {role:message.role,content:message.content,attachments:message.attachments};
  });
  const text = JSON.stringify(messages?.length ? messages : request.prompt || '');
  // UTF-8 bytes conservatively bound text tokens; allow upstream/system overhead.
  // Encoded image bytes are not text tokens. Bound each supported vision input.
  const inputTokens = Buffer.byteLength(text, 'utf8') + 8192 + images * 16384;
  return pricing.calculateChatCost([
    ...(turns?.length ? turns : usage ? [usage] : []), { inputTokens, outputTokens: 4096 }
  ], rate).credits;
}

export async function chatCreditRpc(name, body, fetchImpl = fetch) {
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) throw billingError('credit-service-not-configured');
  const url = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
      if (response.status >= 500 && !attempt) continue;
      if (!response.ok) throw billingError('credit-service-failed');
      const result = await response.json();
      if (!result || typeof result.ok !== 'boolean') throw billingError('credit-service-failed');
      return result;
    } catch (error) {
      if (attempt || error.code) throw error;
    }
  }
  throw billingError('credit-service-failed');
}

export function createChatBilling(userId, requestId, request, fetchImpl = fetch) {
  const claimId = crypto.randomUUID();
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    prompt: request.prompt, messages: request.messages, providerId: request.providerId,
    model: request.model, routingStrategy: request.routingStrategy, canvasId: request.canvasId
  })).digest('hex');
  const reserve = (budget, update = false) => chatCreditRpc('reserve_ai_chat_credits', {
    p_user_id: userId, p_request_id: requestId, p_fingerprint: fingerprint, p_claim_id: claimId,
    p_budget: budget, p_update: update, p_provider_id: String(request.providerId || 'chat-3')
  }, fetchImpl);
  return {
    reserve: () => reserve(0.01),
    async beforeRequest(provider, model, nextRequest, usage, turns) {
      const result = await reserve(chatBudget(nextRequest, usage, chatRate(provider, model), turns), true);
      if (!result.ok) throw billingError(result.reason, result.reason === 'insufficient-credits' ? 402 : 409);
    },
    async settle(result, durationMs) {
      const receipt = result ? {
        ...pricing.calculateChatCost(result.usageTurns?.length ? result.usageTurns : [result.usage], chatRate(result.billingProvider, result.billingModel)),
        model: result.billingModel, providerId: result.billingProvider.id, usage: result.usage, turns: result.usageTurns?.length ? result.usageTurns : [result.usage],
        rate: chatRate(result.billingProvider, result.billingModel)
      } : null;
      const settled = await chatCreditRpc('settle_ai_chat_credits', {
        p_user_id: userId, p_request_id: requestId, p_receipt: receipt,
        p_duration_ms: Math.max(0, Math.round(durationMs))
      }, fetchImpl);
      if (!settled.ok) throw billingError(settled.reason || 'credit-settlement-failed');
      return settled;
    }
  };
}
