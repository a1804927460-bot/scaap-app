'use strict';

const crypto = require('crypto');

const MEMBERSHIP_SCHEMA_VERSION = 1;
const MAX_USAGE_EVENTS = 500;
const LOCAL_MODE = 'local-unmetered';
const SERVER_MODE = 'server-authoritative';

const DEFAULT_ENTITLEMENTS = Object.freeze({
  'ai.chat': Object.freeze({
    enabled: true,
    metering: 'unmetered',
    unit: 'request'
  }),
  'ai.image': Object.freeze({
    enabled: true,
    metering: 'unmetered',
    unit: 'image'
  }),
  'ai.video': Object.freeze({
    enabled: true,
    metering: 'unmetered',
    unit: 'video'
  })
});

function makeDefaultMembershipState() {
  return {
    schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    mode: LOCAL_MODE,
    account: {
      id: null,
      status: 'guest',
      email: null,
      displayName: null
    },
    plan: {
      id: 'free',
      name: 'Free',
      tier: 'free'
    },
    subscription: {
      status: 'inactive',
      provider: null,
      renewsAt: null,
      expiresAt: null
    },
    credits: {
      balance: null,
      reserved: 0,
      currency: 'credits',
      isAuthoritative: false,
      updatedAt: null
    },
    entitlements: clone(DEFAULT_ENTITLEMENTS),
    sync: {
      status: 'local',
      revision: null,
      lastSyncedAt: null
    },
    usageEvents: []
  };
}

function normalizeMembershipState(input) {
  const raw = isPlainObject(input) ? input : {};
  const defaults = makeDefaultMembershipState();
  const mode = raw.mode === SERVER_MODE ? SERVER_MODE : LOCAL_MODE;
  const serverDefaults = mode === SERVER_MODE
    ? {
        'ai.chat': { enabled: false, metering: 'credits', unit: 'request' },
        'ai.image': { enabled: false, metering: 'credits', unit: 'image' },
        'ai.video': { enabled: false, metering: 'credits', unit: 'video' }
      }
    : defaults.entitlements;

  const entitlements = {};
  const rawEntitlements = isPlainObject(raw.entitlements) ? raw.entitlements : {};
  const featureNames = new Set([
    ...Object.keys(serverDefaults),
    ...Object.keys(rawEntitlements)
  ]);
  for (const feature of featureNames) {
    entitlements[feature] = normalizeEntitlement(
      rawEntitlements[feature],
      serverDefaults[feature] || { enabled: false, metering: 'unmetered', unit: 'request' }
    );
  }

  const rawCredits = isPlainObject(raw.credits) ? raw.credits : {};
  const usageEvents = Array.isArray(raw.usageEvents)
    ? raw.usageEvents.slice(-MAX_USAGE_EVENTS).map(normalizeUsageEvent).filter(Boolean)
    : [];

  return {
    schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    mode,
    account: {
      id: nullableString(raw.account && raw.account.id, 160),
      status: raw.account && raw.account.status === 'authenticated' ? 'authenticated' : 'guest',
      email: nullableString(raw.account && raw.account.email, 320),
      displayName: nullableString(raw.account && raw.account.displayName, 160)
    },
    plan: {
      id: boundedString(raw.plan && raw.plan.id, defaults.plan.id, 80),
      name: boundedString(raw.plan && raw.plan.name, defaults.plan.name, 120),
      tier: boundedString(raw.plan && raw.plan.tier, defaults.plan.tier, 80)
    },
    subscription: {
      status: boundedString(
        raw.subscription && raw.subscription.status,
        defaults.subscription.status,
        40
      ),
      provider: nullableString(raw.subscription && raw.subscription.provider, 80),
      renewsAt: nullableDate(raw.subscription && raw.subscription.renewsAt),
      expiresAt: nullableDate(raw.subscription && raw.subscription.expiresAt)
    },
    credits: {
      balance: nullableNonNegativeNumber(rawCredits.balance),
      reserved: nonNegativeNumber(rawCredits.reserved, 0),
      currency: boundedString(rawCredits.currency, defaults.credits.currency, 32),
      isAuthoritative: mode === SERVER_MODE && rawCredits.isAuthoritative === true,
      updatedAt: nullableDate(rawCredits.updatedAt)
    },
    entitlements,
    sync: {
      status: mode === SERVER_MODE
        ? boundedString(raw.sync && raw.sync.status, 'stale', 40)
        : 'local',
      revision: nullableString(raw.sync && raw.sync.revision, 160),
      lastSyncedAt: nullableDate(raw.sync && raw.sync.lastSyncedAt)
    },
    usageEvents
  };
}

function createMembershipService(store, options = {}) {
  if (!store || !store.data) {
    throw new TypeError('A store with a data object is required.');
  }

  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const makeId = typeof options.makeId === 'function'
    ? options.makeId
    : () => `usage-${crypto.randomUUID()}`;

  function persist(state) {
    store.data.membership = state;
    if (typeof store.scheduleSave === 'function') store.scheduleSave();
    return state;
  }

  function currentState() {
    const normalized = normalizeMembershipState(store.data.membership);
    store.data.membership = normalized;
    return normalized;
  }

  function getSnapshot() {
    const state = currentState();
    const usageEvents = state.usageEvents;
    const pendingCount = usageEvents.filter((event) => event.status === 'reserved').length;
    const lastEvent = usageEvents[usageEvents.length - 1] || null;
    const { usageEvents: _privateEvents, ...publicState } = state;
    return clone({
      ...publicState,
      usage: {
        totalEvents: usageEvents.length,
        pendingCount,
        lastEventAt: lastEvent ? (lastEvent.settledAt || lastEvent.startedAt) : null
      }
    });
  }

  function checkFeature(feature) {
    const featureName = String(feature || '').trim();
    const state = currentState();
    const entitlement = state.entitlements[featureName];
    if (!featureName || !entitlement) {
      return {
        allowed: false,
        feature: featureName,
        reason: 'unknown-feature',
        mode: state.mode,
        entitlement: null,
        requiresServerReservation: false
      };
    }
    if (!entitlement.enabled) {
      return {
        allowed: false,
        feature: featureName,
        reason: 'not-entitled',
        mode: state.mode,
        entitlement: clone(entitlement),
        requiresServerReservation: false
      };
    }
    return {
      allowed: true,
      feature: featureName,
      reason: null,
      mode: state.mode,
      entitlement: clone(entitlement),
      requiresServerReservation: state.mode === SERVER_MODE && entitlement.metering === 'credits'
    };
  }

  function beginUsage(feature, details = {}) {
    const access = checkFeature(feature);
    if (!access.allowed) return { ok: false, ...access, usageId: null };

    const state = currentState();
    const startedAt = now();
    const usageId = makeId();
    const event = {
      id: usageId,
      feature: access.feature,
      status: 'reserved',
      startedAt,
      settledAt: null,
      estimatedCredits: nonNegativeNumber(details.estimatedCredits, 0),
      settledCredits: null,
      resultUnits: null,
      failedUnits: null,
      failureCode: null,
      metadata: sanitizeMetadata(details.metadata)
    };
    state.usageEvents.push(event);
    state.usageEvents = state.usageEvents.slice(-MAX_USAGE_EVENTS);
    persist(state);
    return {
      ok: true,
      ...access,
      usageId,
      event: clone(event)
    };
  }

  function finishUsage(usageId, result = {}) {
    const state = currentState();
    const event = state.usageEvents.find((entry) => entry.id === usageId);
    if (!event) return null;
    if (event.status !== 'reserved') return clone(event);

    event.status = normalizeOutcome(result.status);
    event.settledAt = now();
    event.settledCredits = state.mode === LOCAL_MODE
      ? 0
      : nullableNonNegativeNumber(result.settledCredits);
    event.resultUnits = nullableNonNegativeNumber(result.resultUnits);
    event.failedUnits = nullableNonNegativeNumber(result.failedUnits);
    event.failureCode = nullableString(result.failureCode, 120);
    if (isPlainObject(result.metadata)) {
      event.metadata = {
        ...event.metadata,
        ...sanitizeMetadata(result.metadata)
      };
    }
    persist(state);
    return clone(event);
  }

  function applyServerSnapshot(serverSnapshot) {
    if (!isPlainObject(serverSnapshot)) {
      throw new TypeError('A server membership snapshot is required.');
    }
    const current = currentState();
    const syncedAt = now();
    const next = normalizeMembershipState({
      ...serverSnapshot,
      mode: SERVER_MODE,
      credits: {
        ...(isPlainObject(serverSnapshot.credits) ? serverSnapshot.credits : {}),
        isAuthoritative: true
      },
      sync: {
        ...(isPlainObject(serverSnapshot.sync) ? serverSnapshot.sync : {}),
        status: 'synced',
        lastSyncedAt: syncedAt
      },
      usageEvents: current.usageEvents
    });
    return getSnapshotFromState(persist(next));
  }

  const initialState = currentState();
  const interrupted = initialState.usageEvents.filter((event) => event.status === 'reserved');
  if (interrupted.length) {
    const recoveredAt = now();
    interrupted.forEach((event) => {
      event.status = 'failed';
      event.settledAt = recoveredAt;
      event.settledCredits = initialState.mode === LOCAL_MODE ? 0 : null;
      event.resultUnits = 0;
      event.failureCode = 'app-restarted';
    });
  }
  persist(initialState);

  return {
    getSnapshot,
    checkFeature,
    beginUsage,
    finishUsage,
    applyServerSnapshot
  };
}

function getSnapshotFromState(state) {
  const { usageEvents, ...publicState } = state;
  const pendingCount = usageEvents.filter((event) => event.status === 'reserved').length;
  const lastEvent = usageEvents[usageEvents.length - 1] || null;
  return clone({
    ...publicState,
    usage: {
      totalEvents: usageEvents.length,
      pendingCount,
      lastEventAt: lastEvent ? (lastEvent.settledAt || lastEvent.startedAt) : null
    }
  });
}

function normalizeEntitlement(value, fallback) {
  const raw = isPlainObject(value) ? value : {};
  const metering = ['unmetered', 'credits'].includes(raw.metering)
    ? raw.metering
    : fallback.metering;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    metering,
    unit: boundedString(raw.unit, fallback.unit, 40)
  };
}

function normalizeUsageEvent(event) {
  if (!isPlainObject(event)) return null;
  const id = nullableString(event.id, 160);
  const feature = nullableString(event.feature, 120);
  if (!id || !feature) return null;
  return {
    id,
    feature,
    status: ['reserved', 'succeeded', 'partial', 'failed', 'cancelled'].includes(event.status)
      ? event.status
      : 'failed',
    startedAt: nullableDate(event.startedAt) || new Date(0).toISOString(),
    settledAt: nullableDate(event.settledAt),
    estimatedCredits: nonNegativeNumber(event.estimatedCredits, 0),
    settledCredits: nullableNonNegativeNumber(event.settledCredits),
    resultUnits: nullableNonNegativeNumber(event.resultUnits),
    failedUnits: nullableNonNegativeNumber(event.failedUnits),
    failureCode: nullableString(event.failureCode, 120),
    metadata: sanitizeMetadata(event.metadata)
  };
}

function normalizeOutcome(status) {
  return ['succeeded', 'partial', 'failed', 'cancelled'].includes(status)
    ? status
    : 'failed';
}

function sanitizeMetadata(value) {
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    if (/prompt|message|content|text|api.?key|token|secret|password/i.test(key)) continue;
    if (typeof item === 'string') out[key] = item.slice(0, 200);
    else if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
    else if (typeof item === 'boolean' || item === null) out[key] = item;
    else if (Array.isArray(item)) {
      out[key] = item.slice(0, 12).filter((entry) =>
        typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
      );
    }
  }
  return out;
}

function boundedString(value, fallback, maxLength) {
  const stringValue = typeof value === 'string' ? value.trim() : '';
  return stringValue ? stringValue.slice(0, maxLength) : fallback;
}

function nullableString(value, maxLength) {
  const stringValue = typeof value === 'string' ? value.trim() : '';
  return stringValue ? stringValue.slice(0, maxLength) : null;
}

function nullableDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonNegativeNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : fallback;
}

function nullableNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  LOCAL_MODE,
  SERVER_MODE,
  MAX_USAGE_EVENTS,
  makeDefaultMembershipState,
  normalizeMembershipState,
  createMembershipService
};
