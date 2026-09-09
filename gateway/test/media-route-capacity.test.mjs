import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaRouteCapacity } from '../src/media-route-capacity.js';

const cheap={id:'cheap',endpoint:'https://one.example/submit',keyEnv:'ONE_KEY'};
const backup={id:'backup',endpoint:'https://two.example/submit',keyEnv:'TWO_KEY'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('busy cheapest route spills only to supplied affordable candidates and shares alias capacity',async()=>{
  const capacity=new MediaRouteCapacity({maxConcurrent:1,maxPerKey:1});
  const wait=deferred();
  const running=capacity.run(cheap,'a',()=>wait.promise);
  const alias={...cheap,id:'another-model',endpoint:'https://one.example/another'};
  assert.equal(capacity.select([alias,backup],'b'),backup);
  assert.equal(capacity.select([cheap],'b'),cheap,'No unquoted provider may be invented');
  wait.resolve();await running;
  assert.equal(capacity.select([cheap,backup],'b'),cheap);
});

test('full affordable routes queue without starting upstream work; cancelled requests never submit',async()=>{
  const capacity=new MediaRouteCapacity({maxConcurrent:1,maxPerKey:1});
  const wait=deferred();let submitted=0;
  const running=capacity.run(cheap,'a',()=>wait.promise);
  const controller=new AbortController();
  const queued=capacity.run(cheap,'b',()=>{submitted++;},controller.signal);
  const rejected=assert.rejects(queued,e=>e.code==='request-aborted');
  assert.equal(submitted,0);
  controller.abort();await rejected;
  wait.resolve();await running;
  assert.equal(submitted,0);
  assert.equal(capacity.gate(cheap).snapshot().active,0);
});

test('bounded queue rejects excess work before spending, errors release capacity',async()=>{
  const capacity=new MediaRouteCapacity({maxConcurrent:1,maxPerKey:1,maxQueue:1});
  const wait=deferred();
  const running=capacity.run(cheap,'a',()=>wait.promise);
  const queued=capacity.run(cheap,'b',()=>{throw new Error('upstream rejected');});
  const rejected=assert.rejects(queued,/upstream rejected/);
  await assert.rejects(capacity.run(cheap,'c',()=>assert.fail('must not submit')),e=>e.code==='gateway-queue-full');
  wait.resolve();await running;await rejected;
  assert.equal(capacity.gate(cheap).snapshot().active,0);
});
