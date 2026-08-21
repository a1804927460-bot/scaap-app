function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function queueError(code, message, retryAfterSeconds) {
  return Object.assign(new Error(message), {
    code,
    status: 429,
    retryAfterSeconds: Math.max(1, Math.round(Number(retryAfterSeconds) || 1))
  });
}

// A small process-local scheduler for work that occupies an upstream request.
// It deliberately rotates users rather than accepting FIFO starvation from a
// single busy account. Credit reservation remains outside this gate and is
// settled by the caller on every error path.
export class FairConcurrencyGate {
  constructor(options = {}) {
    this.name = String(options.name || 'upstream').slice(0, 64);
    this.maxConcurrent = boundedInteger(options.maxConcurrent, 4, 1, 128);
    this.maxPerKey = boundedInteger(options.maxPerKey, 2, 1, this.maxConcurrent);
    this.maxQueue = boundedInteger(options.maxQueue, 96, 1, 10_000);
    this.timeoutMs = boundedInteger(options.timeoutMs, 90_000, 1_000, 20 * 60_000);
    this.active = 0;
    this.activeByKey = new Map();
    this.queues = new Map();
    this.roundRobinKeys = [];
    this.queued = 0;
  }

  run(key, work, { signal } = {}) {
    if (typeof work !== 'function') return Promise.reject(new TypeError('Queued work must be a function.'));
    const owner = String(key || 'anonymous').slice(0, 256) || 'anonymous';
    if (signal && signal.aborted) {
      return Promise.reject(Object.assign(new Error('The request was cancelled.'), { code: 'request-aborted', status: 499 }));
    }
    if (this.queued >= this.maxQueue) {
      return Promise.reject(queueError('gateway-queue-full', 'The generation queue is busy. Please try again shortly.', 5));
    }
    return new Promise((resolve, reject) => {
      const entry = { owner, work, resolve, reject, timer: null, signal, abort: null, state: 'queued' };
      entry.timer = setTimeout(() => {
        if (entry.state !== 'queued') return;
        this.removeQueuedEntry(entry);
        reject(queueError('gateway-queue-timeout', 'The generation queue is busy. Please try again shortly.', Math.ceil(this.timeoutMs / 1000)));
      }, this.timeoutMs);
      entry.timer.unref?.();
      if (signal) {
        entry.abort = () => {
          if (entry.state !== 'queued') return;
          this.removeQueuedEntry(entry);
          reject(Object.assign(new Error('The request was cancelled.'), { code: 'request-aborted', status: 499 }));
        };
        signal.addEventListener('abort', entry.abort, { once: true });
      }
      const queue = this.queues.get(owner);
      if (queue) queue.push(entry);
      else {
        this.queues.set(owner, [entry]);
        this.roundRobinKeys.push(owner);
      }
      this.queued += 1;
      this.pump();
    });
  }

  removeQueuedEntry(entry) {
    if (!entry || entry.state !== 'queued') return;
    entry.state = 'finished';
    clearTimeout(entry.timer);
    if (entry.signal && entry.abort) entry.signal.removeEventListener('abort', entry.abort);
    const queue = this.queues.get(entry.owner);
    if (queue) {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      if (!queue.length) {
        this.queues.delete(entry.owner);
        const keyIndex = this.roundRobinKeys.indexOf(entry.owner);
        if (keyIndex >= 0) this.roundRobinKeys.splice(keyIndex, 1);
      }
    }
    this.queued = Math.max(0, this.queued - 1);
    this.pump();
  }

  takeNext() {
    const attempts = this.roundRobinKeys.length;
    for (let index = 0; index < attempts; index += 1) {
      const owner = this.roundRobinKeys.shift();
      const queue = this.queues.get(owner);
      if (!queue || !queue.length) {
        this.queues.delete(owner);
        continue;
      }
      if ((this.activeByKey.get(owner) || 0) >= this.maxPerKey) {
        this.roundRobinKeys.push(owner);
        continue;
      }
      const entry = queue.shift();
      if (queue.length) this.roundRobinKeys.push(owner);
      else this.queues.delete(owner);
      return entry;
    }
    return null;
  }

  pump() {
    while (this.active < this.maxConcurrent) {
      const entry = this.takeNext();
      if (!entry) return;
      this.queued = Math.max(0, this.queued - 1);
      this.active += 1;
      this.activeByKey.set(entry.owner, (this.activeByKey.get(entry.owner) || 0) + 1);
      entry.state = 'running';
      clearTimeout(entry.timer);
      if (entry.signal && entry.abort) entry.signal.removeEventListener('abort', entry.abort);
      const finish = () => {
        this.active = Math.max(0, this.active - 1);
        const remaining = Math.max(0, (this.activeByKey.get(entry.owner) || 1) - 1);
        if (remaining) this.activeByKey.set(entry.owner, remaining);
        else this.activeByKey.delete(entry.owner);
        this.pump();
      };
      Promise.resolve()
        .then(() => entry.work())
        .then((value) => { finish(); entry.resolve(value); }, (error) => { finish(); entry.reject(error); });
    }
  }

  snapshot() {
    return {
      name: this.name,
      active: this.active,
      queued: this.queued,
      maxConcurrent: this.maxConcurrent,
      maxPerKey: this.maxPerKey,
      maxQueue: this.maxQueue
    };
  }
}
