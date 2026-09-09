import crypto from 'node:crypto';

export const CREDIT_PACKS = Object.freeze([
  { id: 'start', name: 'START', credits: 1000, amount: 959, currency: 'USD' },
  { id: 'create', name: 'CREATE', credits: 3000, amount: 2877, currency: 'USD' },
  { id: 'studio', name: 'STUDIO', credits: 10000, amount: 9589, currency: 'USD' }
]);
const fail = (code, status = 503) => Object.assign(new Error(code), { code, status });
const base = () => process.env.CREEM_PAYMENT_ENV === 'test' ? 'https://test-api.creem.io' : 'https://api.creem.io';
const productId = id => String(process.env[`CREEM_PRODUCT_${id.toUpperCase()}`] || '');
export function paymentCatalog() {
  const enabled = process.env.CREEM_PAYMENTS_ENABLED === 'true' && !!process.env.CREEM_WEBHOOK_SECRET && !!process.env.CREEM_API_KEY;
  return { packs: CREDIT_PACKS.map(pack => ({ ...pack, available: enabled && !!productId(pack.id) })) };
}
async function rpc(name, body, fetchImpl = fetch) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw fail('payment-service-unavailable');
  const response = await fetchImpl(`${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: secret,
      ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` }) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw fail('payment-storage-failed');
  return response.json();
}
export function verifyCreemEvent(raw, signature, secret = process.env.CREEM_WEBHOOK_SECRET) {
  if (!secret) throw fail('payment-webhook-unavailable');
  if (!Buffer.isBuffer(raw) || raw.length > 262144 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) throw fail('invalid-payment-signature', 400);
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw fail('invalid-payment-signature', 400);
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { throw fail('invalid-payment-event', 400); }
  if (typeof event.id !== 'string' || !event.id || event.id.length > 160 || typeof event.eventType !== 'string') throw fail('invalid-payment-event', 400);
  return event;
}
export async function createCreditCheckout(user, packId, fetchImpl = fetch) {
  const pack = paymentCatalog().packs.find(value => value.id === packId);
  if (!pack) throw fail('invalid-credit-pack', 400);
  if (!pack.available) throw fail('payments-not-enabled');
  const id = crypto.randomUUID();
  await rpc('create_credit_payment', { p_id: id, p_user_id: user.id, p_pack: pack.id,
    p_product: productId(pack.id), p_amount: pack.amount, p_currency: pack.currency, p_credits: pack.credits }, fetchImpl);
  const response = await fetchImpl(`${base()}/v1/checkouts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CREEM_API_KEY },
    body: JSON.stringify({ product_id: productId(pack.id), request_id: id,
      success_url: `${String(process.env.PAYMENT_PUBLIC_URL || 'https://messs-app-production.up.railway.app').replace(/\/$/, '')}/payments/return`,
      metadata: { messs_order_id: id }, ...(user.email ? { customer: { email: user.email } } : {}) }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw fail('payment-checkout-failed');
  const result = await response.json();
  let url;
  try { url = new URL(result.checkout_url); } catch { throw fail('payment-checkout-failed'); }
  if (url.protocol !== 'https:' || !['www.creem.io', 'creem.io', 'checkout.creem.io', 'test-checkout.creem.io'].includes(url.hostname) || url.username || url.password) throw fail('payment-checkout-failed');
  if (typeof result.id !== 'string' || !result.id.startsWith('ch_')) throw fail('payment-checkout-failed');
  await rpc('attach_credit_checkout', { p_id: id, p_checkout: result.id }, fetchImpl);
  return { orderId: id, checkoutUrl: url.href };
}
export async function handleCreditWebhook(raw, signature, fetchImpl = fetch) {
  const event = verifyCreemEvent(raw, signature);
  const object = event.object || {};
  if (event.eventType !== 'checkout.completed') {
    // Persist refund/dispute notifications for operator reconciliation; never silently discard them.
    if (/^(refund|dispute)\./.test(event.eventType)) {
      await rpc('record_credit_payment_review', { p_event_id: event.id, p_kind: event.eventType, p_payload: object }, fetchImpl);
    }
    return { received: true };
  }
  const order = object.order || {}, product = object.product || {};
  const expectedMode = process.env.CREEM_PAYMENT_ENV === 'test' ? 'test' : 'prod';
  if (object.mode !== expectedMode || object.status !== 'completed' || order.status !== 'paid'
    || product.billing_type !== 'onetime' || product.currency !== 'USD'
    || typeof product.id !== 'string' || order.product !== product.id
    || !Number.isSafeInteger(order.amount) || order.amount <= 0
    || order.currency !== product.currency || order.amount !== product.price
    || typeof order.id !== 'string' || typeof object.id !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(object.request_id || '')
    || object.metadata?.messs_order_id !== object.request_id) throw fail('invalid-payment-order', 400);
  await rpc('complete_credit_payment', { p_id: object.request_id, p_event_id: event.id,
    p_checkout: object.id, p_order: order.id, p_product: product.id,
    p_amount: order.amount, p_currency: order.currency }, fetchImpl);
  return { received: true };
}
