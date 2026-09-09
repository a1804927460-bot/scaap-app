import { FairConcurrencyGate } from './fair-concurrency-gate.js';

// Process-local admission control, not a claim about the vendor's account quota.
// Aliases using one host and credential share capacity instead of multiplying it.
export class MediaRouteCapacity {
  constructor(options = {}) {
    this.options = options;
    this.gates = new Map();
  }
  gate(provider) {
    const host = new URL(provider.endpoint).hostname;
    const key = `${host}:${provider.keyEnv || ''}`;
    if (!this.gates.has(key)) this.gates.set(key,new FairConcurrencyGate({
      name:host,maxConcurrent:8,maxPerKey:2,maxQueue:96,timeoutMs:60000,...this.options
    }));
    return this.gates.get(key);
  }
  select(candidates, owner) {
    // The caller must supply only compatible, price-approved candidates in cost
    // order. Never discover a new, unquoted provider to escape a full queue.
    return candidates.find(provider=>{
      const gate=this.gate(provider);
      return gate.queued===0 && gate.active<gate.maxConcurrent
        && (gate.activeByKey.get(String(owner || 'anonymous')) || 0)<gate.maxPerKey;
    }) || candidates[0];
  }
  run(provider,owner,work,signal) {
    return this.gate(provider).run(owner,work,{signal});
  }
}
