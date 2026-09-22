'use strict';

// Each renderer edits its own snapshot. A stale window must not replace other
// windows' sessions, or resurrect entries it has not changed since loading.
function createAgentHistoryWrites() {
  const snapshots = new WeakMap();
  const copy = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function read(sender, key, sessions) {
    let scopes = snapshots.get(sender);
    if (!scopes) snapshots.set(sender, scopes = new Map());
    scopes.set(key, copy(sessions));
    return sessions;
  }
  function save(sender, key, current, incoming) {
    const baseline = snapshots.get(sender)?.get(key) || [];
    const before = new Map(baseline.map(session => [session.id, session]));
    const next = new Map(incoming.map(session => [session.id, session]));
    const merged = new Map(current.map(session => [session.id, session]));
    for (const session of incoming) {
      if (same(before.get(session.id), session)) continue;
      const stored = merged.get(session.id);
      if (!stored || Date.parse(session.updatedAt) >= Date.parse(stored.updatedAt)) {
        // The canvas owning an existing conversation never changes on save.
        merged.set(session.id, stored?.canvasId ? {...session, canvasId:stored.canvasId} : session);
      }
    }
    for (const session of baseline) {
      if (!next.has(session.id) && same(merged.get(session.id), session)) merged.delete(session.id);
    }
    read(sender, key, incoming);
    return [...merged.values()].sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  return {read, save};
}
module.exports = {createAgentHistoryWrites};
