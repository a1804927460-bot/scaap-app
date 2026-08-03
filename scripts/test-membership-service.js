'use strict';

const assert = require('assert');
const {
  LOCAL_MODE,
  SERVER_MODE,
  MAX_USAGE_EVENTS,
  normalizeMembershipState,
  createMembershipService
} = require('../lib/membership-service');

function makeStore(membership) {
  return {
    data: { membership },
    saveCount: 0,
    scheduleSave() {
      this.saveCount += 1;
    }
  };
}

let sequence = 0;
const options = {
  now: () => new Date(Date.UTC(2026, 7, 1, 0, 0, sequence++)).toISOString(),
  makeId: () => `usage-test-${sequence}`
};

const migrated = normalizeMembershipState(undefined);
assert.strictEqual(migrated.schemaVersion, 1);
assert.strictEqual(migrated.mode, LOCAL_MODE);
assert.strictEqual(migrated.account.status, 'guest');
assert.strictEqual(migrated.plan.id, 'free');
assert.strictEqual(migrated.credits.balance, null);
assert.strictEqual(migrated.credits.isAuthoritative, false);
assert.strictEqual(migrated.entitlements['ai.chat'].enabled, true);
assert.strictEqual(migrated.entitlements['ai.image'].metering, 'unmetered');

const store = makeStore({
  entitlements: {
    'ai.video': { enabled: false, metering: 'credits', unit: 'video' }
  }
});
const service = createMembershipService(store, options);
const snapshot = service.getSnapshot();
assert.strictEqual(snapshot.mode, LOCAL_MODE);
assert.strictEqual(snapshot.usage.totalEvents, 0);
assert.strictEqual(service.checkFeature('ai.chat').allowed, true);
assert.strictEqual(service.checkFeature('ai.image').allowed, true);
assert.strictEqual(service.checkFeature('ai.video').allowed, false);
assert.strictEqual(service.checkFeature('ai.video').reason, 'not-entitled');
assert.strictEqual(service.checkFeature('unknown').reason, 'unknown-feature');

const started = service.beginUsage('ai.image', {
  estimatedCredits: 12,
  metadata: {
    providerId: 'image-1',
    requestedCount: 2,
    prompt: 'must not be stored',
    apiKey: 'must not be stored'
  }
});
assert.strictEqual(started.ok, true);
assert.strictEqual(started.event.status, 'reserved');
assert.deepStrictEqual(started.event.metadata, {
  providerId: 'image-1',
  requestedCount: 2
});
assert.strictEqual(service.getSnapshot().usage.pendingCount, 1);

const succeeded = service.finishUsage(started.usageId, {
  status: 'succeeded',
  resultUnits: 2,
  settledCredits: 999
});
assert.strictEqual(succeeded.status, 'succeeded');
assert.strictEqual(succeeded.resultUnits, 2);
assert.strictEqual(succeeded.settledCredits, 0);
assert.strictEqual(service.getSnapshot().usage.pendingCount, 0);
assert.strictEqual(
  service.finishUsage(started.usageId, { status: 'failed' }).status,
  'succeeded',
  'Settling an event must be idempotent.'
);

const failed = service.beginUsage('ai.chat', { metadata: { messageCount: 3 } });
const failedResult = service.finishUsage(failed.usageId, {
  status: 'failed',
  failureCode: 'timeout'
});
assert.strictEqual(failedResult.status, 'failed');
assert.strictEqual(failedResult.failureCode, 'timeout');

const interruptedStore = makeStore({
  usageEvents: [{
    id: 'usage-interrupted',
    feature: 'ai.video',
    status: 'reserved',
    startedAt: '2026-08-01T00:00:00.000Z',
    estimatedCredits: 8,
    metadata: { providerId: 'video-1' }
  }]
});
const recoveredService = createMembershipService(interruptedStore, options);
assert.strictEqual(recoveredService.getSnapshot().usage.pendingCount, 0);
assert.strictEqual(interruptedStore.data.membership.usageEvents[0].status, 'failed');
assert.strictEqual(interruptedStore.data.membership.usageEvents[0].failureCode, 'app-restarted');

for (let index = 0; index < MAX_USAGE_EVENTS + 10; index += 1) {
  service.beginUsage('ai.chat', { metadata: { index } });
}
assert.strictEqual(store.data.membership.usageEvents.length, MAX_USAGE_EVENTS);

store.data.membership.credits.balance = 999999;
const serverSnapshot = service.applyServerSnapshot({
  account: {
    id: 'user-1',
    status: 'authenticated',
    email: 'member@example.com'
  },
  plan: {
    id: 'pro-monthly',
    name: 'Pro',
    tier: 'pro'
  },
  subscription: {
    status: 'active',
    provider: 'future-payment-provider',
    expiresAt: '2026-09-01T00:00:00.000Z'
  },
  credits: {
    balance: 42,
    reserved: 3,
    updatedAt: '2026-08-01T00:00:00.000Z'
  },
  entitlements: {
    'ai.chat': { enabled: true, metering: 'credits', unit: 'request' },
    'ai.image': { enabled: true, metering: 'credits', unit: 'image' },
    'ai.video': { enabled: false, metering: 'credits', unit: 'video' }
  },
  sync: {
    revision: 'membership-revision-7'
  }
});
assert.strictEqual(serverSnapshot.mode, SERVER_MODE);
assert.strictEqual(serverSnapshot.account.id, 'user-1');
assert.strictEqual(serverSnapshot.credits.balance, 42);
assert.strictEqual(serverSnapshot.credits.isAuthoritative, true);
assert.strictEqual(store.data.membership.credits.balance, 42);
assert.strictEqual(service.checkFeature('ai.chat').requiresServerReservation, true);
assert.strictEqual(service.checkFeature('ai.video').allowed, false);
assert.strictEqual(store.data.membership.usageEvents.length, MAX_USAGE_EVENTS);

process.stdout.write('Membership service tests passed.\n');
