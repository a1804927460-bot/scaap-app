'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function emptyState(userId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    userId,
    profile: null,
    friends: [],
    requests: [],
    conversations: [],
    messages: [],
    outbox: [],
    remoteCursor: null,
    lastRemoteSyncAt: null,
    updatedAt: new Date(0).toISOString()
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify(value), 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  durableReplaceSync(temporary, filePath);
  fsyncDirectoryBestEffort(dir);
}

function atomicWriteText(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const handle = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, value, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  durableReplaceSync(temporary, filePath);
  fsyncDirectoryBestEffort(dir);
}

function fsyncDirectoryBestEffort(dir) {
  try {
    const handle = fs.openSync(dir, 'r');
    try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  } catch (error) {
    // Windows does not consistently allow directory handles. File fsync plus
    // the recovery backup remains the durable fallback there.
  }
}

function durableReplaceSync(temporary, filePath) {
  try {
    fs.renameSync(temporary, filePath);
    return;
  } catch (error) {
    if (process.platform !== 'win32' || !fs.existsSync(filePath)) throw error;
  }
  // Windows may refuse rename-over-existing. Keep a durable, predictable
  // backup until the new file is in place so startup can recover through a
  // power loss in the short replacement window.
  const backup = `${filePath}.bak`;
  fs.copyFileSync(filePath, backup);
  const backupHandle = fs.openSync(backup, 'r+');
  try { fs.fsyncSync(backupHandle); } finally { fs.closeSync(backupHandle); }
  fs.rmSync(filePath, { force: true });
  try {
    fs.renameSync(temporary, filePath);
    fsyncDirectoryBestEffort(path.dirname(filePath));
    fs.rmSync(backup, { force: true });
  } catch (replaceError) {
    try { fs.renameSync(backup, filePath); } catch (restoreError) {}
    throw replaceError;
  }
}

function appendDurableJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = fs.openSync(filePath, 'a', 0o600);
  try {
    fs.writeSync(handle, `${JSON.stringify(value)}\n`, null, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function upsertBy(list, record, key = 'id') {
  if (!record || !record[key]) return list;
  const index = list.findIndex((item) => item && item[key] === record[key]);
  if (index < 0) list.push(record);
  else list[index] = { ...list[index], ...record };
  return list;
}

function sameMessageIdentity(existing, incoming) {
  if (!existing || !incoming || existing.clientId !== incoming.clientId) return false;
  if (existing.senderId && incoming.senderId && existing.senderId !== incoming.senderId) return false;
  if (existing.conversationId && incoming.conversationId && existing.conversationId !== incoming.conversationId) return false;
  if (existing.serverId && incoming.serverId && existing.serverId !== incoming.serverId) return false;
  return true;
}

function redactRecalledMessage(message) {
  if (!message || !message.recalledAt) return message;
  return {
    ...message,
    body: '',
    imagePath: null,
    imageMime: null,
    imageWidth: null,
    imageHeight: null,
    localImagePath: null,
    status: 'recalled',
    error: null
  };
}

function upsertMessageByIdentity(list, message) {
  if (!message || !message.clientId) return list;
  const incoming = redactRecalledMessage(message);
  const index = list.findIndex((item) => item && item.clientId === incoming.clientId);
  if (index < 0) list.push(incoming);
  else if (sameMessageIdentity(list[index], incoming)) {
    // Recall is terminal. An overlapping poll or delayed INSERT must never
    // restore message content after an UPDATE has redacted it.
    if (list[index].recalledAt && !incoming.recalledAt) return list;
    list[index] = redactRecalledMessage({ ...list[index], ...incoming });
  }
  return list;
}

function applyEvent(state, event) {
  const payload = event && event.payload || {};
  switch (event && event.type) {
    case 'bootstrap':
      state.profile = payload.profile || state.profile;
      state.friends = safeArray(payload.friends);
      state.requests = safeArray(payload.requests);
      state.conversations = safeArray(payload.conversations);
      if (payload.messages) safeArray(payload.messages).forEach((message) => upsertMessageByIdentity(state.messages, message));
      if (payload.cursor) state.remoteCursor = payload.cursor;
      if (payload.lastRemoteSyncAt) state.lastRemoteSyncAt = payload.lastRemoteSyncAt;
      break;
    case 'merge-messages':
      safeArray(payload.messages).forEach((message) => upsertMessageByIdentity(state.messages, message));
      if (payload.cursor) state.remoteCursor = payload.cursor;
      break;
    case 'upsert-message':
      upsertMessageByIdentity(state.messages, payload.message);
      break;
    case 'enqueue':
      upsertBy(state.outbox, payload.item, 'id');
      break;
    case 'outbox-update':
      upsertBy(state.outbox, payload.item, 'id');
      break;
    case 'outbox-remove':
      state.outbox = state.outbox.filter((item) => item.id !== payload.id);
      break;
    case 'remote-cursor':
      state.remoteCursor = payload.cursor || state.remoteCursor;
      break;
    default:
      break;
  }
  state.updatedAt = event.at || new Date().toISOString();
  return state;
}

function normalizeState(value, userId) {
  const state = emptyState(userId);
  if (!value || value.userId !== userId) return state;
  return {
    ...state,
    ...value,
    schemaVersion: SCHEMA_VERSION,
    userId,
    friends: safeArray(value.friends),
    requests: safeArray(value.requests),
    conversations: safeArray(value.conversations),
    messages: safeArray(value.messages).map(redactRecalledMessage),
    outbox: safeArray(value.outbox)
  };
}

class ChatLocalStore {
  constructor(rootDir) {
    if (!path.isAbsolute(String(rootDir || ''))) throw new Error('Chat data root must be absolute.');
    this.rootDir = path.resolve(rootDir);
    this.userId = null;
    this.userDir = null;
    this.snapshotPath = null;
    this.journalPath = null;
    this.imagesDir = null;
    this.state = null;
    this.journalEventCount = 0;
    this.checkpointTimer = null;
  }

  useUser(userId) {
    const normalized = String(userId || '').trim().toLowerCase();
    if (!UUID_RE.test(normalized)) {
      const error = new Error('The signed-in account has an invalid user ID.');
      error.code = 'invalid-user-id';
      throw error;
    }
    if (normalized === this.userId && this.state) return this.getSummary();
    this.flushCheckpoint();
    this.userId = normalized;
    this.userDir = path.join(this.rootDir, 'users', normalized);
    this.snapshotPath = path.join(this.userDir, 'history.v1.json');
    this.journalPath = path.join(this.userDir, 'events.v1.jsonl');
    this.imagesDir = path.join(this.userDir, 'images');
    fs.mkdirSync(this.imagesDir, { recursive: true });
    this.state = this._load();
    return this.getSummary();
  }

  detach() {
    this.flushCheckpoint();
    this.userId = null;
    this.userDir = null;
    this.snapshotPath = null;
    this.journalPath = null;
    this.imagesDir = null;
    this.state = null;
    this.journalEventCount = 0;
  }

  _load() {
    let state = emptyState(this.userId);
    this.journalEventCount = 0;
    let snapshotLoaded = false;
    const snapshotReadPath = fs.existsSync(this.snapshotPath)
      ? this.snapshotPath
      : (fs.existsSync(`${this.snapshotPath}.bak`) ? `${this.snapshotPath}.bak` : this.snapshotPath);
    try {
      state = normalizeState(JSON.parse(fs.readFileSync(snapshotReadPath, 'utf8')), this.userId);
      snapshotLoaded = true;
    } catch (error) {}
    try {
      const journalReadPath = fs.existsSync(this.journalPath)
        ? this.journalPath
        : (fs.existsSync(`${this.journalPath}.bak`) ? `${this.journalPath}.bak` : this.journalPath);
      const lines = fs.readFileSync(journalReadPath, 'utf8').split(/\r?\n/).filter(Boolean);
      this.journalEventCount = lines.length;
      for (const line of lines) {
        try { applyEvent(state, JSON.parse(line)); } catch (error) {}
      }
    } catch (error) {}
    // Persist the replayed state. A partially written final journal line is
    // ignored; every earlier fsync'd event remains recoverable.
    if (!snapshotLoaded || this.journalEventCount || snapshotReadPath !== this.snapshotPath) atomicWriteJson(this.snapshotPath, state);
    if (this.journalEventCount) {
      atomicWriteText(this.journalPath, '');
      this.journalEventCount = 0;
    }
    fs.rmSync(`${this.snapshotPath}.bak`, { force: true });
    fs.rmSync(`${this.journalPath}.bak`, { force: true });
    return state;
  }

  _requireState() {
    if (!this.state) {
      const error = new Error('Chat storage is not attached to a signed-in account.');
      error.code = 'auth-required';
      throw error;
    }
  }

  commit(type, payload) {
    this._requireState();
    const event = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      type,
      payload: payload || {}
    };
    // Write-ahead journal first, then replace the materialized snapshot. This
    // means an app or power failure can at worst leave a replayable event.
    appendDurableJsonLine(this.journalPath, event);
    applyEvent(this.state, event);
    this.journalEventCount += 1;
    this._scheduleCheckpoint(this.journalEventCount >= 200 ? 0 : 2000);
    return event;
  }

  _scheduleCheckpoint(delayMs) {
    if (this.checkpointTimer) {
      if (delayMs > 0) return;
      clearTimeout(this.checkpointTimer);
    }
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null;
      try { this.flushCheckpoint(); } catch (error) {}
    }, Math.max(0, delayMs));
  }

  flushCheckpoint() {
    if (!this.state || !this.snapshotPath) return;
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = null;
    if (this.journalEventCount === 0 && fs.existsSync(this.snapshotPath)) return;
    // Snapshot replacement happens before journal compaction. If the process
    // stops between the two renames, replay is safe because every reducer is
    // idempotent by client/event ID.
    atomicWriteJson(this.snapshotPath, this.state);
    atomicWriteText(this.journalPath, '');
    this.journalEventCount = 0;
    fs.rmSync(`${this.snapshotPath}.bak`, { force: true });
    fs.rmSync(`${this.journalPath}.bak`, { force: true });
  }

  applyBootstrap(payload) {
    this.commit('bootstrap', payload);
    return this.getSummary();
  }

  mergeMessages(messages, cursor = null) {
    this.commit('merge-messages', { messages: safeArray(messages), cursor });
  }

  upsertMessage(message) {
    this.commit('upsert-message', { message });
    return this.getMessage(message && message.clientId);
  }

  enqueue(item) {
    this.commit('enqueue', { item });
    return item;
  }

  updateOutbox(item) {
    this.commit('outbox-update', { item });
    return item;
  }

  removeOutbox(id) {
    this.commit('outbox-remove', { id });
  }

  setRemoteCursor(cursor) {
    if (cursor && cursor.createdAt && cursor.serverId) this.commit('remote-cursor', { cursor });
  }

  getRemoteCursor() {
    this._requireState();
    return this.state.remoteCursor ? { ...this.state.remoteCursor } : null;
  }

  getOutbox() {
    this._requireState();
    return this.state.outbox.map((item) => ({ ...item }));
  }

  getMessage(clientId) {
    this._requireState();
    return this.state.messages.find((message) => message.clientId === clientId) || null;
  }

  getMessages(conversationId, options = {}) {
    this._requireState();
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 40));
    const cursor = options.cursor && typeof options.cursor === 'object' ? options.cursor : null;
    const cursorTime = cursor && cursor.createdAt ? Date.parse(cursor.createdAt) : Infinity;
    const cursorId = cursor && cursor.clientId ? String(cursor.clientId) : '';
    const compareDesc = (a, b) => {
      const aTime = Date.parse(a.createdAt || a.localCreatedAt || 0);
      const bTime = Date.parse(b.createdAt || b.localCreatedAt || 0);
      if (aTime !== bTime) return bTime - aTime;
      return String(b.clientId || '').localeCompare(String(a.clientId || ''));
    };
    const rows = this.state.messages
      .filter((message) => message.conversationId === conversationId)
      .filter((message) => {
        const timestamp = Date.parse(message.createdAt || message.localCreatedAt || 0);
        if (!Number.isFinite(timestamp)) return false;
        if (!cursor || !Number.isFinite(cursorTime)) return true;
        return timestamp < cursorTime || (timestamp === cursorTime && String(message.clientId || '') < cursorId);
      })
      .sort(compareDesc);
    const page = rows.slice(0, limit).reverse().map((message) => {
      const { localImagePath, ...publicMessage } = message;
      return publicMessage;
    });
    const oldest = page[0] || null;
    return {
      messages: page,
      hasMore: rows.length > limit,
      nextCursor: oldest ? {
        createdAt: oldest.createdAt || oldest.localCreatedAt,
        clientId: oldest.clientId
      } : null
    };
  }

  async cacheImageFromFile(clientId, sourcePath, extension) {
    this._requireState();
    const ext = /^\.[a-z0-9]{1,8}$/i.test(extension || '') ? extension.toLowerCase() : '.img';
    const destination = path.join(this.imagesDir, `${clientId}${ext}`);
    if (fs.existsSync(destination)) return destination;
    const temporary = path.join(this.imagesDir, `.${clientId}.${crypto.randomUUID()}.tmp`);
    await fs.promises.copyFile(sourcePath, temporary);
    const handle = await fs.promises.open(temporary, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await fs.promises.rename(temporary, destination);
    return destination;
  }

  async cacheImageBuffer(clientId, buffer, extension) {
    this._requireState();
    const ext = /^\.[a-z0-9]{1,8}$/i.test(extension || '') ? extension.toLowerCase() : '.img';
    const destination = path.join(this.imagesDir, `${clientId}${ext}`);
    if (fs.existsSync(destination)) return destination;
    const temporary = path.join(this.imagesDir, `.${clientId}.${crypto.randomUUID()}.tmp`);
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(buffer); await handle.sync(); } finally { await handle.close(); }
    await fs.promises.rename(temporary, destination);
    return destination;
  }

  imagePathForMessage(clientId) {
    this._requireState();
    const message = this.getMessage(clientId);
    if (message && message.localImagePath) {
      const resolved = path.resolve(message.localImagePath);
      const relative = path.relative(this.imagesDir, resolved);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(resolved)) return resolved;
    }
    try {
      const prefix = `${clientId}.`;
      const found = fs.readdirSync(this.imagesDir).find((name) => name.startsWith(prefix));
      return found ? path.join(this.imagesDir, found) : null;
    } catch (error) {
      return null;
    }
  }

  removeCachedImage(clientId) {
    this._requireState();
    const safeClientId = String(clientId || '').trim().toLowerCase();
    if (!UUID_RE.test(safeClientId)) return 0;
    let removed = 0;
    try {
      fs.readdirSync(this.imagesDir).forEach((name) => {
        if (!name.startsWith(`${safeClientId}.`)) return;
        fs.rmSync(path.join(this.imagesDir, name), { force: true });
        removed += 1;
      });
    } catch (error) {}
    return removed;
  }

  getSummary() {
    this._requireState();
    return {
      profile: this.state.profile ? { ...this.state.profile } : null,
      friends: this.state.friends.map((item) => ({ ...item })),
      requests: this.state.requests.map((item) => ({ ...item })),
      conversations: this.state.conversations.map((item) => ({ ...item })),
      pendingCount: this.state.outbox.length,
      lastRemoteSyncAt: this.state.lastRemoteSyncAt
    };
  }
}

module.exports = {
  ChatLocalStore,
  SCHEMA_VERSION,
  UUID_RE,
  atomicWriteJson,
  atomicWriteText,
  fsyncDirectoryBestEffort,
  appendDurableJsonLine,
  applyEvent,
  emptyState,
  sameMessageIdentity,
  redactRecalledMessage
};
