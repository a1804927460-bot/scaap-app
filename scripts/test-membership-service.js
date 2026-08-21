'use strict';

const assert = require('assert');
const crypto = require('crypto');
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
assert.strictEqual(migrated.schemaVersion, 2);
assert.strictEqual(migrated.mode, LOCAL_MODE);
assert.strictEqual(migrated.account.status, 'guest');
assert.strictEqual(migrated.plan.id, 'free');
assert.strictEqual(migrated.credits.balance, 0);
assert.strictEqual(migrated.credits.reserved, 0);
assert.strictEqual(migrated.credits.isAuthoritative, false);
assert.strictEqual(migrated.entitlements['ai.chat'].metering, 'credits');
assert.strictEqual(migrated.entitlements['ai.image'].metering, 'credits');
assert.strictEqual(migrated.entitlements['ai.video'].metering, 'credits');

const legacy = normalizeMembershipState({
  schemaVersion: 1,
  credits: { balance: null },
  entitlements: {
    'ai.chat': { enabled: true, metering: 'credits', unit: 'request' },
    'ai.image': { enabled: true, metering: 'unmetered', unit: 'image' },
    'ai.video': { enabled: true, metering: 'unmetered', unit: 'video' }
  }
});
assert.strictEqual(legacy.credits.balance, 0);
assert.strictEqual(legacy.entitlements['ai.chat'].metering, 'credits');
assert.strictEqual(legacy.entitlements['ai.image'].metering, 'credits');
assert.strictEqual(legacy.entitlements['ai.video'].metering, 'credits');

const store = makeStore({
  schemaVersion: 1,
  entitlements: {
    'ai.video': { enabled: true, metering: 'unmetered', unit: 'video' }
  }
});
const service = createMembershipService(store, options);
let snapshot = service.getSnapshot();
assert.strictEqual(snapshot.mode, LOCAL_MODE);
assert.strictEqual(snapshot.usage.totalEvents, 0);
assert.strictEqual(snapshot.credits.balance, 0);
assert.strictEqual(service.checkFeature('ai.chat').allowed, true);
assert.strictEqual(service.checkFeature('ai.image').allowed, true);
assert.strictEqual(service.checkFeature('ai.video').allowed, true);
assert.strictEqual(service.checkFeature('unknown').reason, 'unknown-feature');

const blockedImage = service.beginUsage('ai.image', { estimatedCredits: 12 });
assert.strictEqual(blockedImage.ok, false);
assert.strictEqual(blockedImage.reason, 'insufficient-credits');
assert.strictEqual(blockedImage.requiredCredits, 12);
assert.strictEqual(blockedImage.availableCredits, 0);
assert.strictEqual(service.getSnapshot().usage.totalEvents, 0);

const grant = {
  id: 'beta-credit-1',
  codeHash: crypto.createHash('sha256').update('beta-credit-1').digest('hex'),
  credits: 100
};
const redeemed = service.redeemGrant(grant);
assert.strictEqual(redeemed.ok, true);
assert.strictEqual(redeemed.creditsAdded, 100);
assert.strictEqual(redeemed.snapshot.credits.balance, 100);
const duplicate = service.redeemGrant(grant);
assert.strictEqual(duplicate.ok, false);
assert.strictEqual(duplicate.reason, 'already-redeemed');
assert.strictEqual(duplicate.snapshot.credits.balance, 100);

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
snapshot = service.getSnapshot();
assert.strictEqual(snapshot.credits.balance, 100);
assert.strictEqual(snapshot.credits.reserved, 12);
assert.strictEqual(snapshot.usage.pendingCount, 1);

const succeeded = service.finishUsage(started.usageId, {
  status: 'succeeded',
  resultUnits: 2,
  settledCredits: 15
});
assert.strictEqual(succeeded.status, 'succeeded');
assert.strictEqual(succeeded.resultUnits, 2);
assert.strictEqual(succeeded.settledCredits, 15);
snapshot = service.getSnapshot();
assert.strictEqual(snapshot.credits.balance, 85);
assert.strictEqual(snapshot.credits.reserved, 0);
assert.strictEqual(snapshot.usage.pendingCount, 0);
assert.strictEqual(
  service.finishUsage(started.usageId, { status: 'failed' }).status,
  'succeeded',
  'Settling an event must be idempotent.'
);

const failedVideo = service.beginUsage('ai.video', { estimatedCredits: 16 });
assert.strictEqual(failedVideo.ok, true);
assert.strictEqual(service.getSnapshot().credits.reserved, 16);
const failedResult = service.finishUsage(failedVideo.usageId, {
  status: 'failed',
  failureCode: 'timeout'
});
assert.strictEqual(failedResult.status, 'failed');
assert.strictEqual(failedResult.settledCredits, 0);
assert.strictEqual(service.getSnapshot().credits.balance, 85);
assert.strictEqual(service.getSnapshot().credits.reserved, 0);

// Chat uses the same points gate as every other AI function.
store.data.membership.credits.balance = 0;
const blockedChat = service.beginUsage('ai.chat', {
  estimatedCredits: 105,
  metadata: { messageCount: 3 }
});
assert.strictEqual(blockedChat.ok, false);
assert.strictEqual(blockedChat.reason, 'insufficient-credits');
assert.strictEqual(service.getSnapshot().credits.reserved, 0);
const interruptedStore = makeStore({
  credits: { balance: 20, reserved: 8 },
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
assert.strictEqual(recoveredService.getSnapshot().credits.balance, 20);
assert.strictEqual(recoveredService.getSnapshot().credits.reserved, 0);
assert.strictEqual(interruptedStore.data.membership.usageEvents[0].status, 'failed');
assert.strictEqual(interruptedStore.data.membership.usageEvents[0].failureCode, 'app-restarted');

store.data.membership.credits.balance = MAX_USAGE_EVENTS + 10;
for (let index = 0; index < MAX_USAGE_EVENTS + 10; index += 1) {
  service.beginUsage('ai.chat', { estimatedCredits: 1, metadata: { index } });
}
assert.strictEqual(store.data.membership.usageEvents.length, MAX_USAGE_EVENTS);

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
    'ai.image': { enabled: true, metering: 'unmetered', unit: 'image' },
    'ai.video': { enabled: false, metering: 'unmetered', unit: 'video' }
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
assert.strictEqual(service.checkFeature('ai.chat').entitlement.metering, 'credits');
assert.strictEqual(service.checkFeature('ai.image').entitlement.metering, 'credits');
assert.strictEqual(service.checkFeature('ai.image').requiresServerReservation, true);
assert.strictEqual(service.checkFeature('ai.video').allowed, false);
assert.strictEqual(store.data.membership.usageEvents.length, MAX_USAGE_EVENTS);

process.stdout.write('Membership service tests passed.\n');
