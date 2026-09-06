import { createHmac } from 'node:crypto';

const channels = new Map([
  ['nano_banana_v2_max','nano_banana_v2_plus'],
  ['nano_banana_pro_max','nano_banana_pro_plus']
]);
const failures = new Map();

export function selectImageChannel(provider, body, env = process.env, now = Date.now()) {
  if (provider.kind !== 'image' || provider.protocol !== 'aireiter-async'
      || body._acceptedTask || !channels.has(provider.model)) return provider;
  if (new URL(provider.endpoint).origin !== 'https://aireiter.com') return provider;
  const percent = Number(env.AIREITER_IMAGE_PLUS_PERCENT || 0);
  const secret = String(env.AIREITER_IMAGE_ROUTING_SECRET || '');
  const operation = String(body.operationId || '');
  if (!Number.isFinite(percent) || percent <= 0 || percent > 40 || secret.length < 32 || !operation) return provider;
  const alternative = channels.get(provider.model);
  if ((failures.get(alternative)?.until || 0) > now) return provider;
  const bucket = createHmac('sha256',secret).update(`image-channel-v1:${provider.model}:${operation}`).digest().readUInt32BE(0) / 0x100000000 * 100;
  return bucket < percent ? {...provider,model:alternative} : provider;
}

export function recordImageChannelResult(model, error, now = Date.now()) {
  if (![...channels.values()].includes(model)) return;
  if (!error) { failures.delete(model); return; }
  if (error.name === 'AbortError') return;
  const previous = failures.get(model);
  const count = previous && now - previous.last < 5*60_000 ? previous.count+1 : 1;
  failures.set(model,{count,last:now,until:count >= 3 ? now+10*60_000 : 0});
}
