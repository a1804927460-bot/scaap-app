'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { ChatLocalStore, UUID_RE, sameMessageIdentity } = require('./chat-local-store');

const CHAT_SCHEMA_VERSION = 2;
const CHAT_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

const IMAGE_MIME = Object.freeze({
  jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff', bmp: 'image/bmp'
});

function chatError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function validateChatSearch(value) {
  const query = String(value || '').trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
  const isMesssId = /^MSS-[A-Z0-9]{8,16}$/i.test(query);
  if (!isEmail && !isMesssId) {
    throw chatError('请输入完整邮箱或 Messs ID。', 'invalid-search');
  }
  return isEmail ? query.toLowerCase() : query.toUpperCase();
}

function validateTextMessage(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw chatError('消息不能为空。', 'empty-message');
  if (text.length > 8000) throw chatError('单条消息最多 8000 个字符。', 'message-too-long');
  return text;
}

function validateUuid(value, label = 'ID') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw chatError(`${label} 无效。`, 'invalid-id');
  return normalized;
}

function extensionForMime(mime, fallback = '.img') {
  const map = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/avif': '.avif', 'image/tiff': '.tiff', 'image/bmp': '.bmp'
  };
  return map[String(mime || '').toLowerCase()] || fallback;
}

function isStorageAlreadyExists(error) {
  if (!error) return false;
  const status = Number(error.statusCode || error.status || 0);
  return status === 409 || /already exists|resource exists|duplicate/i.test(String(error.message || ''));
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    messsId: row.messs_id || row.messsId || '',
    displayName: row.display_name || row.displayName || 'Messs user',
    email: row.email || '',
    avatarUrl: row.avatar_url || row.avatarUrl || null,
    relationshipStatus: row.relationship_status || row.relationshipStatus || null
  };
}

function normalizeMessage(row) {
  if (!row) return null;
  const clientId = row.client_message_id || row.clientId || row.id;
  return {
    clientId,
    serverId: row.id || row.serverId || null,
    conversationId: row.conversation_id || row.conversationId,
    senderId: row.sender_id || row.senderId,
    kind: row.kind === 'image' ? 'image' : 'text',
    body: row.body || '',
    imagePath: row.image_path || row.imagePath || null,
    imageMime: row.image_mime || row.imageMime || null,
    imageWidth: Number(row.image_width || row.imageWidth) || null,
    imageHeight: Number(row.image_height || row.imageHeight) || null,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    localCreatedAt: row.localCreatedAt || row.created_at || row.createdAt || new Date().toISOString(),
    status: row.status || 'sent',
    error: row.error || null,
    localImagePath: row.localImagePath || null
  };
}

function normalizeBootstrap(data) {
  const value = data && typeof data === 'object' ? data : {};
  return {
    profile: normalizeProfile(value.profile),
    friends: (Array.isArray(value.friends) ? value.friends : []).map(normalizeProfile).filter(Boolean),
    requests: (Array.isArray(value.requests) ? value.requests : []).map((row) => ({
      id: row.id,
      direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
      status: row.status || 'pending',
      createdAt: row.created_at || row.createdAt,
      profile: normalizeProfile(row.profile)
    })),
    conversations: (Array.isArray(value.conversations) ? value.conversations : []).map((row) => ({
      id: row.id,
      createdAt: row.created_at || row.createdAt,
      updatedAt: row.updated_at || row.updatedAt,
      other: normalizeProfile(row.other)
    }))
  };
}

function publicFailure(error, fallback = '聊天服务暂时不可用。') {
  const raw = String(error && error.message || '');
  const code = String(error && error.code || '');
  const setupRequired = /PGRST202|PGRST205|42P01|42883|schema cache|could not find (?:the )?(?:function|table)|relation .* does not exist|bucket not found|NoSuchBucket|chat-schema-version|chat-image-storage-unavailable/i.test(`${code} ${raw}`);
  const network = /fetch failed|failed to fetch|network|offline|ENOTFOUND|ECONN|EAI_AGAIN|AbortError|timeout/i.test(`${code} ${raw}`);
  if (setupRequired) {
    return {
      ok: false,
      reason: 'setup-required',
      message: '聊天云端服务正在准备中；本机历史仍可查看，稍后可点击同步重试。'
    };
  }
  return {
    ok: false,
    reason: network ? 'offline' : (code || 'chat-failed'),
    message: network ? '当前网络不可用；未发出的消息已安全保存在本机，将自动重试。' : (raw || fallback)
  };
}

class ChatService {
  constructor(options) {
    this.supabaseUrl = String(options.supabaseUrl || '').replace(/\/$/, '');
    this.publishableKey = String(options.publishableKey || '').trim();
    this.getAccessToken = options.getAccessToken;
    this.getPublicSession = options.getPublicSession;
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.sharp = options.sharp || null;
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    this.local = new ChatLocalStore(options.localRoot);
    this.client = null;
    this.clientUserId = null;
    this.clientToken = null;
    this.channel = null;
    this.syncPromise = null;
    this.flushPromise = null;
    this.retryTimer = null;
    this.pollTimer = null;
    this.realtimeReady = false;
    this.realtimeSubscribeTimeoutMs = Math.max(100, Number(options.realtimeSubscribeTimeoutMs) || 8_000);
    this.status = 'idle';
    this.lastError = null;
    this.cloud = {
      schemaVersion: null,
      rpcReady: false,
      messagesReady: false,
      imageStorageReady: null,
      realtimeConfigured: null,
      realtimeConnected: false
    };
  }

  isConfigured() {
    return Boolean(this.supabaseUrl && this.publishableKey);
  }

  _sessionUser() {
    const session = this.getPublicSession && this.getPublicSession();
    return session && session.authenticated && session.user ? session.user : null;
  }

  _attachLocal() {
    const user = this._sessionUser();
    if (!user || !user.id) throw chatError('请先登录 Messs 账号。', 'auth-required');
    this.local.useUser(user.id);
    return user;
  }

  _publicState() {
    const user = this._sessionUser();
    if (!user) return { configured: this.isConfigured(), authenticated: false, status: 'signed-out' };
    const summary = this.local.userId === String(user.id).toLowerCase()
      ? this.local.getSummary()
      : this.local.useUser(user.id);
    return {
      configured: this.isConfigured(),
      authenticated: true,
      user: { id: user.id, email: user.email || null },
      status: this.status,
      lastError: this.lastError,
      cloud: { ...this.cloud },
      ...summary
    };
  }

  _emit(type, detail = {}) {
    this.onEvent({ type, detail, state: this._publicState() });
  }

  _recordCloudFailure(error, fallback) {
    const failure = publicFailure(error, fallback);
    if (failure.reason !== 'setup-required' && failure.reason !== 'offline') return failure;
    this.status = failure.reason === 'setup-required' ? 'setup-required' : 'offline';
    this.lastError = failure.message;
    this.cloud.realtimeConnected = false;
    if (failure.reason === 'setup-required' && !this.cloud.rpcReady) {
      this.cloud = {
        schemaVersion: null,
        rpcReady: false,
        messagesReady: false,
        imageStorageReady: false,
        realtimeConfigured: false,
        realtimeConnected: false
      };
    }
    this._emit('connection', { status: this.status, reason: failure.reason, message: failure.message });
    return failure;
  }

  async initialize() {
    if (!this.isConfigured()) return { configured: false, authenticated: false, status: 'not-configured' };
    const previousUserId = this.local.userId;
    try {
      const user = this._attachLocal();
      if (!this.local.state.profile) {
        this.local.applyBootstrap({
          profile: {
            id: user.id,
            messsId: '',
            displayName: String(user.email || '').split('@')[0] || 'Messs user',
            email: user.email || ''
          },
          friends: [],
          requests: [],
          conversations: []
        });
      }
    } catch (error) {
      return this._publicState();
    }
    if (!previousUserId || previousUserId !== this.local.userId || ['idle', 'signed-out'].includes(this.status)) {
      this.status = 'syncing';
      this.lastError = null;
    }
    this._startBackgroundTimers();
    this._emit('session');
    // Returning the durable local snapshot first keeps history available even
    // while offline. Cloud reconciliation continues in the background.
    this.syncRemote().catch(() => {});
    return this._publicState();
  }

  async _ensureClient() {
    const user = this._attachLocal();
    let token;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      const publicSession = this._sessionUser();
      if (!publicSession || error && error.code === 'auth-required') throw error;
      const offline = chatError('当前网络不可用；聊天历史仍可在本机查看。', 'offline', error);
      offline.status = error && error.status;
      throw offline;
    }
    if (this.client && this.clientUserId === user.id && this.clientToken === token) {
      await this.client.realtime.setAuth(token);
      return this.client;
    }
    await this._unsubscribe();
    this.client = createClient(this.supabaseUrl, this.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: this.fetch },
      realtime: { params: { eventsPerSecond: 20 } }
    });
    this.clientUserId = user.id;
    this.clientToken = token;
    this.realtimeReady = false;
    this.cloud.realtimeConnected = false;
    await this.client.realtime.setAuth(token);
    return this.client;
  }

  _startBackgroundTimers() {
    if (!this.retryTimer) this.retryTimer = setInterval(() => this.flushOutbox().catch(() => {}), 10_000);
    if (!this.pollTimer) this.pollTimer = setInterval(() => this.syncRemote().catch(() => {}), 30_000);
  }

  async _subscribe() {
    if (!this.client || this.cloud.realtimeConfigured === false) return false;
    if (this.channel && this.realtimeReady) return true;
    if (this.channel) await this._unsubscribe();
    const channel = this.client.channel(`messs-chat-${this.clientUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        this._acceptRemoteMessage(payload.new).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_friend_requests' }, () => {
        this.syncBootstrap().catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_friendships' }, () => {
        this.syncBootstrap().catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversation_members' }, () => {
        this.syncBootstrap().catch(() => {});
      });
    this.channel = channel;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (connected) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(connected);
      };
      const timer = setTimeout(() => {
        this.realtimeReady = false;
        this.cloud.realtimeConnected = false;
        finish(false);
      }, this.realtimeSubscribeTimeoutMs);
      channel.subscribe((status) => {
        if (channel !== this.channel) return;
        if (status === 'SUBSCRIBED') {
          this.realtimeReady = true;
          this.cloud.realtimeConnected = true;
          this.status = 'online';
          this.lastError = null;
          this._emit('connection', { status: 'online' });
          finish(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.realtimeReady = false;
          this.cloud.realtimeConnected = false;
          if (this.status === 'online') {
            this.status = 'sync-only';
            this.lastError = '云端同步可用；实时消息连接正在自动重试。';
            this._emit('connection', { status: 'sync-only', message: this.lastError });
          }
          finish(false);
        }
      });
    });
  }

  async _unsubscribe() {
    const channel = this.channel;
    this.channel = null;
    this.realtimeReady = false;
    this.cloud.realtimeConnected = false;
    if (this.client && channel) {
      try { await this.client.removeChannel(channel); } catch (error) {}
    }
  }

  async checkCloudDependencies(client = null) {
    const activeClient = client || await this._ensureClient();
    const { data, error } = await activeClient.rpc('chat_service_status');
    if (error) throw chatError(error.message, error.code || 'chat-schema-unavailable');
    const value = Array.isArray(data) ? data[0] : data;
    const schemaVersion = Number(value && (value.schema_version || value.schemaVersion));
    const rpcReady = value && (value.rpc_ready === true || value.rpcReady === true);
    const messagesReady = value && (value.messages_ready === true || value.messagesReady === true);
    if (!Number.isInteger(schemaVersion) || schemaVersion < CHAT_SCHEMA_VERSION || !rpcReady || !messagesReady) {
      throw chatError('Chat schema version is unavailable.', 'chat-schema-version');
    }
    this.cloud = {
      schemaVersion,
      rpcReady,
      messagesReady,
      imageStorageReady: value.image_storage === true || value.imageStorage === true,
      realtimeConfigured: value.realtime === true || value.realtimeConfigured === true,
      realtimeConnected: this.realtimeReady
    };
    return { ...this.cloud };
  }

  async syncBootstrap(options = {}) {
    const client = options.client || await this._ensureClient();
    const { data, error } = await client.rpc('chat_bootstrap');
    if (error) throw chatError(error.message, error.code || 'bootstrap-failed');
    const normalized = normalizeBootstrap(data);
    if (options.persist !== false) {
      this.local.applyBootstrap({ ...normalized, lastRemoteSyncAt: new Date().toISOString() });
      this._emit('bootstrap');
    }
    return normalized;
  }

  async _loadRemoteMessages(client, cursor) {
    const pageSize = 500;
    const messages = [];
    for (let from = 0; ; from += pageSize) {
      let query = client
        .from('chat_messages')
        .select('id,client_message_id,conversation_id,sender_id,kind,body,image_path,image_mime,image_width,image_height,created_at')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      // The first successful sync intentionally backfills all history. Every
      // later poll starts at the durable composite cursor and only transfers
      // new rows (gte plus local ID filtering safely includes the boundary).
      if (cursor && cursor.createdAt) {
        // A small overlap protects against a transaction that started before
        // the last poll but committed just after it. Local client IDs dedupe
        // the repeated boundary rows.
        const overlapAt = new Date(Math.max(0, Date.parse(cursor.createdAt) - 5 * 60_000)).toISOString();
        query = query.gte('created_at', overlapAt);
      }
      const { data, error } = await query
        .range(from, from + pageSize - 1);
      if (error) throw chatError(error.message, error.code || 'history-sync-failed');
      const page = (data || []).map(normalizeMessage).filter(Boolean);
      messages.push(...page);
      if ((data || []).length < pageSize) break;
    }
    return messages;
  }

  async syncRemote() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = (async () => {
      try {
        const client = await this._ensureClient();
        const dependencies = await this.checkCloudDependencies(client);
        const bootstrap = await this.syncBootstrap({ persist: false, client });
        const allowedConversationIds = new Set(bootstrap.conversations.map((item) => item.id));
        const previousCursor = this.local.getRemoteCursor();
        const messages = await this._loadRemoteMessages(client, previousCursor);
        this.cloud.messagesReady = true;
        const visibleMessages = messages.filter((message) => allowedConversationIds.has(message.conversationId));
        const last = visibleMessages[visibleMessages.length - 1];
        this.local.applyBootstrap({
          ...bootstrap,
          messages: visibleMessages,
          cursor: last ? { createdAt: last.createdAt, serverId: last.serverId } : null,
          lastRemoteSyncAt: new Date().toISOString()
        });
        const realtimeConnected = dependencies.realtimeConfigured ? await this._subscribe() : false;
        this.status = realtimeConnected ? 'online' : 'sync-only';
        this.lastError = !dependencies.imageStorageReady
          ? '文字消息可同步，图片云端存储尚未启用。'
          : realtimeConnected
            ? null
            : '云端同步可用；实时消息连接正在自动重试。';
        await this.flushOutbox();
        this._emit('synced', { messageCount: visibleMessages.length, realtime: realtimeConnected });
        this._cacheMissingImages(visibleMessages).catch(() => {});
        return this._publicState();
      } catch (error) {
        this._recordCloudFailure(error);
        throw error;
      } finally {
        this.syncPromise = null;
      }
    })();
    return this.syncPromise;
  }

  async sync() {
    try {
      return { ok: true, state: await this.syncRemote() };
    } catch (error) {
      return { ...publicFailure(error), state: this._publicState() };
    }
  }

  async searchUser(value) {
    const query = validateChatSearch(value);
    try {
      const client = await this._ensureClient();
      const { data, error } = await client.rpc('search_chat_profile', { p_query: query });
      if (error) throw chatError(error.message, error.code || 'search-failed');
      const profile = normalizeProfile(Array.isArray(data) ? data[0] : data);
      return { ok: true, profile };
    } catch (error) {
      return this._recordCloudFailure(error, '无法搜索用户。');
    }
  }

  async sendFriendRequest(targetId) {
    try {
      const client = await this._ensureClient();
      const { error } = await client.rpc('send_chat_friend_request', { p_target_id: validateUuid(targetId, '用户 ID') });
      if (error) throw chatError(error.message, error.code || 'friend-request-failed');
      await this.syncBootstrap();
      return { ok: true, state: this._publicState() };
    } catch (error) {
      return this._recordCloudFailure(error, '好友请求发送失败。');
    }
  }

  async respondFriendRequest(requestId, action) {
    const normalizedAction = action === 'accept' ? 'accept' : action === 'reject' ? 'reject' : '';
    if (!normalizedAction) return publicFailure(chatError('操作无效。', 'invalid-action'));
    try {
      const client = await this._ensureClient();
      const { error } = await client.rpc('respond_chat_friend_request', {
        p_request_id: validateUuid(requestId, '请求 ID'),
        p_action: normalizedAction
      });
      if (error) throw chatError(error.message, error.code || 'friend-response-failed');
      await this.syncBootstrap();
      return { ok: true, state: this._publicState() };
    } catch (error) {
      return this._recordCloudFailure(error, '无法处理好友请求。');
    }
  }

  async startConversation(friendId) {
    try {
      const client = await this._ensureClient();
      const { data, error } = await client.rpc('create_chat_direct_conversation', {
        p_friend_id: validateUuid(friendId, '好友 ID')
      });
      if (error) throw chatError(error.message, error.code || 'conversation-failed');
      await this.syncBootstrap();
      return { ok: true, conversationId: String(data), state: this._publicState() };
    } catch (error) {
      return this._recordCloudFailure(error, '无法发起对话。');
    }
  }

  _assertConversation(conversationId) {
    const id = validateUuid(conversationId, '会话 ID');
    const summary = this.local.getSummary();
    if (!summary.conversations.some((item) => item.id === id)) {
      throw chatError('该会话不在当前账号中。', 'conversation-not-found');
    }
    return id;
  }

  async sendText(conversationId, body) {
    const user = this._attachLocal();
    const id = this._assertConversation(conversationId);
    const now = new Date().toISOString();
    const message = {
      clientId: crypto.randomUUID(), conversationId: id, senderId: user.id,
      kind: 'text', body: validateTextMessage(body), createdAt: now, localCreatedAt: now,
      status: 'queued', error: null
    };
    this.local.upsertMessage(message);
    this.local.enqueue({
      id: message.clientId, type: 'message', message, attempts: 0, nextAttemptAt: 0, lastError: null
    });
    this._emit('message', { conversationId: id, clientId: message.clientId });
    this.flushOutbox().catch(() => {});
    const { localImagePath, ...publicMessage } = this.local.getMessage(message.clientId);
    return { ok: true, message: publicMessage };
  }

  async sendImage(conversationId, sourcePath) {
    if (this.cloud.imageStorageReady === false) {
      throw chatError('聊天图片云端存储尚未启用；当前没有上传图片，也不会伪装为已发送。', 'chat-image-storage-unavailable');
    }
    const { user, id, metadata, mime, clientId, localImagePath } = await this.prepareImage(conversationId, sourcePath);
    const now = new Date().toISOString();
    const message = {
      clientId, conversationId: id, senderId: user.id, kind: 'image', body: '',
      imageMime: mime, imageWidth: metadata.width || null, imageHeight: metadata.height || null,
      localImagePath, createdAt: now, localCreatedAt: now, status: 'queued', error: null
    };
    this.local.upsertMessage(message);
    this.local.enqueue({
      id: clientId, type: 'message', message, localImagePath,
      attempts: 0, nextAttemptAt: 0, lastError: null
    });
    this._emit('message', { conversationId: id, clientId });
    this.flushOutbox().catch(() => {});
    const { localImagePath: privateImagePath, ...publicMessage } = this.local.getMessage(clientId);
    return { ok: true, message: publicMessage };
  }

  async prepareImage(conversationId, sourcePath) {
    if (!this.sharp) throw chatError('当前版本缺少图片处理组件。', 'image-tools-unavailable');
    const user = this._attachLocal();
    const id = this._assertConversation(conversationId);
    const absolute = path.resolve(String(sourcePath || ''));
    const stat = await fs.promises.stat(absolute).catch(() => null);
    if (!stat || !stat.isFile()) throw chatError('选择的图片不存在。', 'image-not-found');
    if (stat.size > CHAT_IMAGE_MAX_BYTES) {
      throw chatError('聊天图片不能超过 50 MB。', 'image-too-large');
    }
    const metadata = await this.sharp(absolute, { failOn: 'none', limitInputPixels: false }).metadata();
    const mime = IMAGE_MIME[String(metadata.format || '').toLowerCase()];
    if (!mime) throw chatError('请选择 PNG、JPEG、WebP、GIF、AVIF、TIFF 或 BMP 图片。', 'unsupported-image');
    const clientId = crypto.randomUUID();
    const ext = extensionForMime(mime, path.extname(absolute));
    const localImagePath = await this.local.cacheImageFromFile(clientId, absolute, ext);
    return { user, id, metadata, mime, clientId, localImagePath };
  }

  async _sendOutboxItem(client, item) {
    const message = item.message;
    let imagePath = message.imagePath || null;
    let imageBucket = null;
    let uploadedImagePath = null;
    if (message.kind === 'image') {
      const extension = extensionForMime(message.imageMime);
      imagePath = `${message.conversationId}/${message.senderId}/${message.clientId}${extension}`;
      const bytes = await fs.promises.readFile(item.localImagePath);
      if (bytes.length > CHAT_IMAGE_MAX_BYTES) throw chatError('聊天图片不能超过 50 MB。', 'image-too-large');
      imageBucket = client.storage.from('chat-images');
      const upload = await imageBucket.upload(imagePath, bytes, {
        contentType: message.imageMime,
        cacheControl: '31536000',
        upsert: false
      });
      if (upload.error && !isStorageAlreadyExists(upload.error)) {
        throw chatError(upload.error.message, upload.error.statusCode || 'image-upload-failed');
      }
      // A conflict can be a retry after a successful immutable upload. The
      // idempotent RPC below decides whether the object belongs to this exact
      // message; failed RPCs trigger a best-effort orphan cleanup.
      uploadedImagePath = imagePath;
    }
    try {
      const { data, error } = await client.rpc('send_chat_message', {
        p_conversation_id: message.conversationId,
        p_client_message_id: message.clientId,
        p_kind: message.kind,
        p_body: message.body || null,
        p_image_path: imagePath,
        p_image_mime: message.imageMime || null,
        p_image_width: message.imageWidth || null,
        p_image_height: message.imageHeight || null
      });
      if (error) throw chatError(error.message, error.code || 'message-send-failed');
      const remote = normalizeMessage(Array.isArray(data) ? data[0] : data);
      return { ...remote, localImagePath: message.localImagePath || item.localImagePath || null, status: 'sent', error: null };
    } catch (error) {
      if (imageBucket && uploadedImagePath) {
        try { await imageBucket.remove([uploadedImagePath]); } catch (cleanupError) {}
      }
      throw error;
    }
  }

  async flushOutbox() {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      const pending = this.local.getOutbox().sort((a, b) => (a.message.localCreatedAt || '').localeCompare(b.message.localCreatedAt || ''));
      if (!pending.length) return { ok: true, sent: 0 };
      let client;
      try { client = await this._ensureClient(); } catch (error) {
        const failure = publicFailure(error);
        pending.forEach((item) => {
          const nextItem = {
            ...item,
            attempts: Number(item.attempts || 0) + 1,
            nextAttemptAt: Date.now() + 10_000,
            lastError: failure.message
          };
          this.local.updateOutbox(nextItem);
          this.local.upsertMessage({ ...item.message, status: 'queued', error: failure.message });
          this._emit('message', { conversationId: item.message.conversationId, clientId: item.id });
        });
        return failure;
      }
      let sent = 0;
      const blockedConversations = new Set();
      for (const item of pending) {
        if (blockedConversations.has(item.message.conversationId)) continue;
        if (Number(item.nextAttemptAt) > Date.now()) {
          blockedConversations.add(item.message.conversationId);
          continue;
        }
        try {
          const message = await this._sendOutboxItem(client, item);
          this.local.upsertMessage(message);
          this.local.removeOutbox(item.id);
          sent += 1;
          this._emit('message', { conversationId: message.conversationId, clientId: message.clientId });
        } catch (error) {
          const attempts = Number(item.attempts || 0) + 1;
          const delay = Math.min(5 * 60_000, 2 ** Math.min(attempts, 8) * 2_000);
          const failure = publicFailure(error);
          const nextItem = { ...item, attempts, nextAttemptAt: Date.now() + delay, lastError: failure.message };
          this.local.updateOutbox(nextItem);
          this.local.upsertMessage({ ...item.message, status: 'queued', error: failure.message });
          this._emit('message', { conversationId: item.message.conversationId, clientId: item.id });
          // Preserve ordering within this conversation without allowing one
          // offline/bad thread to block every other friend.
          blockedConversations.add(item.message.conversationId);
        }
      }
      return { ok: true, sent };
    })().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  async retryMessage(clientId) {
    this._attachLocal();
    const safeClientId = validateUuid(clientId, '消息 ID');
    const item = this.local.getOutbox().find((row) => row.id === safeClientId);
    if (!item) return { ok: false, reason: 'not-pending', message: '这条消息已经发送或不存在。' };
    this.local.updateOutbox({ ...item, nextAttemptAt: 0, lastError: null });
    return this.flushOutbox();
  }

  getHistory(conversationId, options) {
    this._attachLocal();
    return this.local.getMessages(this._assertConversation(conversationId), options);
  }

  async loadOlderRemote(conversationId, options = {}) {
    const id = this._assertConversation(conversationId);
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
    const cursor = options.cursor && typeof options.cursor === 'object' ? options.cursor : null;
    try {
      const client = await this._ensureClient();
      let query = client
        .from('chat_messages')
        .select('id,client_message_id,conversation_id,sender_id,kind,body,image_path,image_mime,image_width,image_height,created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (cursor && cursor.createdAt) {
        const timestamp = new Date(cursor.createdAt).toISOString();
        query = query.lte('created_at', timestamp);
      }
      const { data, error } = await query;
      if (error) throw chatError(error.message, error.code || 'history-sync-failed');
      let messages = (data || []).map(normalizeMessage).filter(Boolean);
      if (cursor && cursor.createdAt) {
        const cursorTime = Date.parse(cursor.createdAt);
        const cursorClientId = String(cursor.clientId || '');
        messages = messages.filter((message) => {
          const stamp = Date.parse(message.createdAt);
          return stamp < cursorTime || (stamp === cursorTime && String(message.clientId) < cursorClientId);
        });
      }
      messages = messages.slice(0, limit);
      if (messages.length) this.local.mergeMessages(messages);
      this._cacheMissingImages(messages).catch(() => {});
      return this.local.getMessages(id, options);
    } catch (error) {
      // Offline history is still authoritative for everything previously
      // synced. The caller gets that page instead of losing access entirely.
      return this.local.getMessages(id, options);
    }
  }

  async _acceptRemoteMessage(row) {
    const message = normalizeMessage(row);
    if (!message) return;
    if (!this.local.getSummary().conversations.some((item) => item.id === message.conversationId)) {
      return;
    }
    const existing = this.local.getMessage(message.clientId);
    if (existing && !sameMessageIdentity(existing, message)) return;
    this.local.upsertMessage({ ...message, localImagePath: existing && existing.localImagePath || null, status: 'sent' });
    if (this.local.getOutbox().some((item) => item.id === message.clientId)) this.local.removeOutbox(message.clientId);
    this._emit('message', { conversationId: message.conversationId, clientId: message.clientId });
    if (message.kind === 'image') this._cacheRemoteImage(message).catch(() => {});
  }

  async _cacheRemoteImage(message) {
    if (!message || !message.imagePath) return null;
    const expectedPath = `${message.conversationId}/${message.senderId}/${message.clientId}${extensionForMime(message.imageMime)}`;
    if (String(message.imagePath) !== expectedPath) {
      throw chatError('图片对象路径无效。', 'invalid-image-path');
    }
    const existing = this.local.imagePathForMessage(message.clientId);
    if (existing) return existing;
    const client = await this._ensureClient();
    const { data, error } = await client.storage.from('chat-images').download(message.imagePath);
    if (error) throw chatError(error.message, error.statusCode || 'image-download-failed');
    const maximumBytes = CHAT_IMAGE_MAX_BYTES;
    if (Number(data.size) > maximumBytes) throw chatError('图片超过 50 MB。', 'image-too-large');
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length > maximumBytes) throw chatError('图片超过 50 MB。', 'image-too-large');
    const localImagePath = await this.local.cacheImageBuffer(
      message.clientId, buffer, extensionForMime(message.imageMime)
    );
    this.local.upsertMessage({ ...message, localImagePath });
    this._emit('image-cached', { conversationId: message.conversationId, clientId: message.clientId });
    return localImagePath;
  }

  async _cacheMissingImages(messages) {
    const queue = messages.filter((message) => message.kind === 'image' && message.imagePath && !this.local.imagePathForMessage(message.clientId));
    for (const message of queue) {
      try { await this._cacheRemoteImage(message); } catch (error) {}
    }
  }

  async getImageDataUrl(clientId) {
    this._attachLocal();
    const safeClientId = validateUuid(clientId, '消息 ID');
    const message = this.local.getMessage(safeClientId);
    if (!message || message.kind !== 'image') return { ok: false, reason: 'not-found' };
    let localPath = this.local.imagePathForMessage(safeClientId);
    if (!localPath && message.imagePath) {
      try { localPath = await this._cacheRemoteImage(message); } catch (error) { return publicFailure(error, '图片暂时无法下载。'); }
    }
    if (!localPath) return { ok: false, reason: 'not-found', message: '本机图片副本不存在。' };
    const mime = message.imageMime || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${(await fs.promises.readFile(localPath)).toString('base64')}`;
    return { ok: true, dataUrl };
  }

  async signOut() {
    await this._unsubscribe();
    this.client = null;
    this.clientUserId = null;
    this.clientToken = null;
    this.realtimeReady = false;
    this.status = 'signed-out';
    this.lastError = null;
    this.cloud = {
      schemaVersion: null,
      rpcReady: false,
      messagesReady: false,
      imageStorageReady: null,
      realtimeConfigured: null,
      realtimeConnected: false
    };
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.retryTimer = null;
    this.pollTimer = null;
    this.local.detach();
    this.onEvent({
      type: 'session',
      detail: {},
      state: { configured: this.isConfigured(), authenticated: false, status: 'signed-out' }
    });
  }

  async close() {
    await this._unsubscribe();
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.retryTimer = null;
    this.pollTimer = null;
    this.client = null;
    this.clientUserId = null;
    this.clientToken = null;
    this.local.flushCheckpoint();
  }

  flushLocal() {
    this.local.flushCheckpoint();
  }
}

module.exports = {
  ChatService,
  validateChatSearch,
  validateTextMessage,
  validateUuid,
  normalizeMessage,
  normalizeBootstrap,
  publicFailure,
  CHAT_SCHEMA_VERSION
};
