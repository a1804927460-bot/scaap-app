import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatBilling, chatBudget, chatRate } from '../src/chat-billing.js';
import calculator from '../../lib/chat-cost-pricing.js';
import { publicGatewayError } from '../src/public-errors.js';
const provider = { id: 'chat-4', endpoint: 'https://api.aireiter.com/v1/chat/completions' };
const model = 'gpt-5.6-sol';
const usage = {inputTokens:4400,outputTokens:66,cachedInputTokens:4224};

test('verified cached tokens and fallback model determine actual fractional charge', () => {
  assert.equal(calculator.calculateChatCost([usage],chatRate(provider,model)).credits,0.14);
  assert.notEqual(calculator.calculateChatCost([usage],chatRate(provider,'gemini-3.8-flash')).credits,0.14);
  assert.throws(()=>chatRate({...provider,endpoint:'https://other.example/v1'},model));
  assert.throws(()=>chatRate(provider,'unpriced-model'));
  assert.throws(()=>calculator.calculateChatCost([null],chatRate(provider,model)));
  assert.throws(()=>calculator.calculateChatCost([{...usage,cachedInputTokens:5000}],chatRate(provider,model)));
});

test('reservation grows for continuations without rounding usage repeatedly', () => {
  const rate=chatRate(provider,model), request={messages:[{role:'user',content:'hello'}]};
  assert.ok(chatBudget(request,usage,rate)>chatBudget(request,null,rate));
});

test('billing is server owned and retries a lost RPC response with the same claim', async () => {
  process.env.SUPABASE_SECRET_KEY='test-not-a-secret';
  const calls=[];
  const fetcher=async(url,options)=>{
    const body=JSON.parse(options.body); calls.push({url,body});
    if(calls.length===1)throw new TypeError('lost response');
    return new Response(JSON.stringify({ok:true,creditsCharged:0.14}),{status:200});
  };
  const billing=createChatBilling('user','request',{prompt:'hello',credits:0},fetcher);
  await billing.reserve();
  assert.deepEqual(calls[0].body,calls[1].body);
  await billing.beforeRequest(provider,model,{prompt:'hello'},null);
  assert.equal(calls[2].body.p_update,true);
  assert.ok(calls[2].body.p_budget>0);
  await billing.settle({usage,billingModel:model,billingProvider:provider},100);
  assert.equal(calls[3].body.p_receipt.credits,0.14);
  assert.equal(calls[3].body.p_receipt.model,model);
  await billing.settle(null,200);
  assert.equal(calls[4].body.p_receipt,null);
});

test('insufficient balance prevents a provider submission and stays a billing error',async()=>{
  process.env.SUPABASE_SECRET_KEY='test-not-a-secret';
  const billing=createChatBilling('user','request',{},async()=>new Response(JSON.stringify({ok:false,reason:'insufficient-credits'})));
  await assert.rejects(billing.beforeRequest(provider,model,{prompt:'hello'},null),{code:'insufficient-credits',status:402});
  assert.equal(publicGatewayError({code:'insufficient-credits',status:402,operationKind:'chat',providerTaskAccepted:true}).code,'insufficient-credits');
});
