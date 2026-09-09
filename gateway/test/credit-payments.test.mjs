import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyCreemEvent, handleCreditWebhook, createCreditCheckout, paymentCatalog } from '../src/credit-payments.js';
const secret = 'fixture-secret';
const event = () => ({ id: 'evt_fixture', eventType: 'checkout.completed', object: {
  id: 'ch_fixture', mode: 'prod', status: 'completed', request_id: '11111111-1111-4111-8111-111111111111',
  metadata: { messs_order_id: '11111111-1111-4111-8111-111111111111' },
  product: { id: 'prod_fixture', billing_type: 'onetime', currency: 'USD', price: 959 },
  order: { id: 'ord_fixture', product: 'prod_fixture', amount: 959, currency: 'USD', status: 'paid' }
} });
const sign = raw => crypto.createHmac('sha256', secret).update(raw).digest('hex');
test('webhook authenticates original bytes and rejects tampering or malformed signatures', () => {
  const raw = Buffer.from(JSON.stringify(event()));
  assert.equal(verifyCreemEvent(raw, sign(raw), secret).id, 'evt_fixture');
  for (const signature of ['', '00', 'z'.repeat(64), '0'.repeat(64)]) assert.throws(() => verifyCreemEvent(raw, signature, secret));
  assert.throws(() => verifyCreemEvent(Buffer.concat([raw, Buffer.from(' ')]), sign(raw), secret));
});
test('only matching paid production one-time orders reach durable completion', async () => {
  process.env.CREEM_WEBHOOK_SECRET = secret; process.env.SUPABASE_SECRET_KEY = 'sb_secret_fixture';
  process.env.SUPABASE_URL = 'https://database.example'; delete process.env.CREEM_PAYMENT_ENV;
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.ok(url.endsWith('/complete_credit_payment'));
    const body = JSON.parse(options.body); assert.equal(body.p_amount, 959);
    assert.equal(body.p_order, 'ord_fixture');
    return Response.json({ ok: true });
  };
  const raw = Buffer.from(JSON.stringify(event()));
  await handleCreditWebhook(raw, sign(raw), fetcher); assert.equal(calls, 1);
  for (const mutate of [
    x => x.object.mode = 'test', x => x.object.status = 'pending',
    x => x.object.order.status = 'pending', x => x.object.order.amount = 1,
    x => x.object.order.currency = 'EUR', x => x.object.order.product = 'prod_other',
    x => x.object.metadata.messs_order_id = crypto.randomUUID(),
    x => x.object.product.billing_type = 'recurring'
  ]) {
    const invalid = event(); mutate(invalid); const bytes = Buffer.from(JSON.stringify(invalid));
    await assert.rejects(handleCreditWebhook(bytes, sign(bytes), fetcher));
  }
  assert.equal(calls, 1);
});
test('refund notifications persist for reconciliation and storage failures are retried', async () => {
  const raw = Buffer.from(JSON.stringify({ id: 'evt_refund', eventType: 'refund.created', object: { id: 'ref_fixture' } }));
  await handleCreditWebhook(raw, sign(raw), async url => { assert.ok(url.endsWith('/record_credit_payment_review')); return Response.json({ ok: true }); });
  await assert.rejects(handleCreditWebhook(raw, sign(raw), async () => new Response('', { status: 503 })));
});
test('checkout uses authoritative price and account, rejects redirect injection', async () => {
  process.env.CREEM_PAYMENTS_ENABLED = 'true'; process.env.CREEM_API_KEY = 'fixture'; process.env.CREEM_PRODUCT_START = 'prod_fixture';
  assert.equal(paymentCatalog().packs[0].amount, 959);
  const calls = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    if (url.endsWith('/create_credit_payment')) { assert.equal(body.p_user_id, 'user_fixture'); assert.equal(body.p_credits, 1000); return Response.json({ ok: true }); }
    if (url.endsWith('/v1/checkouts')) return Response.json({ id: 'ch_fixture', checkout_url: 'https://evil.example/checkout' });
    throw Error('unexpected request');
  };
  await assert.rejects(createCreditCheckout({ id: 'user_fixture' }, 'start', fetcher));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].metadata.messs_order_id, calls[0].p_id);
  delete process.env.CREEM_PAYMENTS_ENABLED;
  await assert.rejects(createCreditCheckout({ id: 'user_fixture' }, 'start', fetcher));
  assert.equal(calls.length, 2);
});
