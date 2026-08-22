'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ChatLocalStore } = require('../lib/chat-local-store');
const {
  ChatService,
  validateChatSearch,
  validateTextMessage,
  validateUuid,
  normalizeMessage,
  normalizeBootstrap,
  publicFailure,
  CHAT_SCHEMA_VERSION,
  CHAT_RECALL_SCHEMA_VERSION,
  CHAT_GROUP_SCHEMA_VERSION
} = require('../lib/chat-service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONVERSATION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function message(clientId, conversationId, createdAt, extra = {}) {
  return {
    clientId,
    serverId: extra.serverId || crypto.randomUUID(),
    conversationId,
    senderId: USER_ID,
    kind: 'text',
    body: extra.body || clientId,
    createdAt,
    localCreatedAt: createdAt,
    status: extra.status || 'sent',
    ...extra
  };
}

(async () => {
  assert.strictEqual(validateChatSearch(' Person@Example.com '), 'person@example.com');
  assert.strictEqual(validateChatSearch('mss-abcd1234'), 'MSS-ABCD1234');
  assert.throws(() => validateChatSearch('person'), /完整邮箱/);
  assert.strictEqual(validateTextMessage(' hello '), 'hello');
  assert.throws(() => validateTextMessage('   '), /不能为空/);
  assert.strictEqual(validateUuid(USER_ID), USER_ID);
  assert.throws(() => validateUuid('../escape'), /无效/);
  assert.deepStrictEqual(
    normalizeMessage({
      id: '33333333-3333-4333-8333-333333333333',
      client_message_id: '44444444-4444-4444-8444-444444444444',
      conversation_id: CONVERSATION_A,
      sender_id: USER_ID,
      kind: 'image',
      body: 'must not survive',
      image_path: 'private/image.png',
      image_mime: 'image/png',
      image_width: 100,
      image_height: 100,
      created_at: '2026-08-04T09:00:00.000Z',
      updated_at: '2026-08-04T09:01:00.000Z',
      recalled_at: '2026-08-04T09:01:00.000Z',
      recalled_by: USER_ID
    }),
    {
      clientId: '44444444-4444-4444-8444-444444444444',
      serverId: '33333333-3333-4333-8333-333333333333',
      conversationId: CONVERSATION_A,
      senderId: USER_ID,
      kind: 'image',
      body: '',
      imagePath: null,
      imageMime: null,
      imageWidth: null,
      imageHeight: null,
      createdAt: '2026-08-04T09:00:00.000Z',
      updatedAt: '2026-08-04T09:01:00.000Z',
      recalledAt: '2026-08-04T09:01:00.000Z',
      recalledBy: USER_ID,
      localCreatedAt: '2026-08-04T09:00:00.000Z',
      status: 'recalled',
      error: null,
      localImagePath: null
    }
  );
  assert.strictEqual(normalizeBootstrap({ friends: [{ id: FRIEND_ID, relationship_status: 'friend' }] }).friends[0].relationshipStatus, 'friend');
  const groupBootstrap = normalizeBootstrap({ conversations: [{
    id: CONVERSATION_A,
    type: 'group',
    name: 'Design team',
    owner_id: USER_ID,
    member_count: 2,
    members: [{ id: USER_ID, display_name: 'Alice' }, { id: FRIEND_ID, display_name: 'Bob' }]
  }] });
  assert.strictEqual(groupBootstrap.conversations[0].type, 'group');
  assert.strictEqual(groupBootstrap.conversations[0].name, 'Design team');
  assert.strictEqual(groupBootstrap.conversations[0].memberCount, 2);
  assert.strictEqual(groupBootstrap.conversations[0].other, null);
  assert.strictEqual(CHAT_GROUP_SCHEMA_VERSION, 5);
  assert.deepStrictEqual(publicFailure(Object.assign(new Error('Could not find the function public.chat_bootstrap in the schema cache'), { code: 'PGRST202' })), {
    ok: false,
    reason: 'setup-required',
    message: '聊天云端服务正在准备中；本机历史仍可查看，稍后可点击同步重试。'
  });
  assert.strictEqual(publicFailure(new Error('fetch failed')).reason, 'offline');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-chat-test-'));
  try {
    const local = new ChatLocalStore(root);
    local.useUser(USER_ID);
    local.applyBootstrap({
      profile: { id: USER_ID, messsId: 'MSS-11111111', displayName: 'Alice' },
      friends: [{ id: FRIEND_ID, messsId: 'MSS-22222222', displayName: 'Bob' }],
      requests: [],
      conversations: [
        { id: CONVERSATION_A, other: { id: FRIEND_ID, displayName: 'Bob' } },
        { id: CONVERSATION_B, other: { id: FRIEND_ID, displayName: 'Bob' } }
      ]
    });

    // Same-millisecond rows paginate through a stable (createdAt, clientId)
    // cursor without skipping the boundary record.
    const stamp = '2026-08-04T10:00:00.000Z';
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003'
    ];
    ids.forEach((id) => local.upsertMessage(message(id, CONVERSATION_A, stamp)));
    const newest = local.getMessages(CONVERSATION_A, { limit: 2 });
    assert.deepStrictEqual(newest.messages.map((item) => item.clientId), [ids[1], ids[2]]);
    assert.strictEqual(newest.hasMore, true);
    const older = local.getMessages(CONVERSATION_A, { limit: 2, cursor: newest.nextCursor });
    assert.deepStrictEqual(older.messages.map((item) => item.clientId), [ids[0]]);
    assert.ok(!Object.prototype.hasOwnProperty.call(newest.messages[0], 'localImagePath'));

    // A remote row cannot reuse another sender's client UUID to replace a
    // message already stored under that identity. A different server row is
    // rejected for the same reason once the local row has a server identity.
    const protectedId = '00000000-0000-4000-8000-000000000010';
    const protectedServerId = '00000000-0000-4000-8000-000000000011';
    local.upsertMessage(message(protectedId, CONVERSATION_A, stamp, {
      serverId: protectedServerId,
      body: 'original'
    }));
    local.upsertMessage(message(protectedId, CONVERSATION_A, stamp, {
      serverId: '00000000-0000-4000-8000-000000000012',
      senderId: FRIEND_ID,
      body: 'collision'
    }));
    assert.strictEqual(local.getMessage(protectedId).senderId, USER_ID);
    assert.strictEqual(local.getMessage(protectedId).serverId, protectedServerId);
    assert.strictEqual(local.getMessage(protectedId).body, 'original');

    // A journaled event is recoverable before the delayed snapshot checkpoint,
    // which models an abrupt restart after accepting a message/outbox item.
    const queuedId = '00000000-0000-4000-8000-000000000004';
    const queued = message(queuedId, CONVERSATION_A, '2026-08-04T10:00:01.000Z', { status: 'queued' });
    local.upsertMessage(queued);
    local.enqueue({ id: queuedId, type: 'message', message: queued, attempts: 0, nextAttemptAt: 0 });
    const recalledId = '00000000-0000-4000-8000-000000000020';
    const beforeRecall = message(recalledId, CONVERSATION_A, '2026-08-04T10:00:02.000Z', {
      body: 'private content'
    });
    local.upsertMessage(beforeRecall);
    local.upsertMessage({
      ...beforeRecall,
      body: '',
      recalledAt: '2026-08-04T10:00:03.000Z',
      recalledBy: USER_ID,
      updatedAt: '2026-08-04T10:00:03.000Z',
      status: 'recalled'
    });
    // A delayed pre-recall row cannot restore redacted content.
    local.upsertMessage(beforeRecall);
    const restarted = new ChatLocalStore(root);
    restarted.useUser(USER_ID);
    assert.strictEqual(restarted.getMessage(queuedId).status, 'queued');
    assert.strictEqual(restarted.getOutbox().length, 1);
    assert.strictEqual(restarted.getMessage(recalledId).status, 'recalled');
    assert.strictEqual(restarted.getMessage(recalledId).body, '');

    // Images are copied into the versioned, per-user managed directory.
    const source = path.join(root, 'source.png');
    fs.writeFileSync(source, Buffer.from('image-bytes'));
    const managed = await restarted.cacheImageFromFile(queuedId, source, '.png');
    assert.strictEqual(fs.readFileSync(managed, 'utf8'), 'image-bytes');
    assert.ok(managed.startsWith(path.join(root, 'users', USER_ID, 'images')));
    assert.strictEqual(restarted.removeCachedImage(queuedId), 1);
    assert.strictEqual(fs.existsSync(managed), false);

    // A failed thread blocks only its own later messages. A different
    // conversation continues flushing in the same pass.
    const serviceRoot = path.join(root, 'service');
    const service = new ChatService({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'publishable-test-key',
      localRoot: serviceRoot,
      getAccessToken: async () => 'token',
      getPublicSession: () => ({ authenticated: true, user: { id: USER_ID, email: 'a@example.com' } }),
      fetchImpl: global.fetch
    });
    // Chat reuses the already authenticated Messs/Supabase session; there is
    // no second chat-specific login state.
    service.syncRemote = async () => ({ authenticated: true, status: 'online' });
    const initialized = await service.initialize();
    assert.strictEqual(initialized.authenticated, true);
    assert.strictEqual(initialized.user.id, USER_ID);
    service.local.useUser(USER_ID);
    const a1 = message('10000000-0000-4000-8000-000000000001', CONVERSATION_A, '2026-08-04T11:00:00.000Z', { status: 'queued' });
    const a2 = message('10000000-0000-4000-8000-000000000002', CONVERSATION_A, '2026-08-04T11:00:01.000Z', { status: 'queued' });
    const b1 = message('10000000-0000-4000-8000-000000000003', CONVERSATION_B, '2026-08-04T11:00:02.000Z', { status: 'queued' });
    [a1, a2, b1].forEach((item) => {
      service.local.upsertMessage(item);
      service.local.enqueue({ id: item.clientId, type: 'message', message: item, attempts: 0, nextAttemptAt: 0 });
    });
    service._ensureClient = async () => ({});
    const attempts = [];
    service._sendOutboxItem = async (_client, item) => {
      attempts.push(item.id);
      if (item.message.conversationId === CONVERSATION_A) throw new Error('offline');
      return { ...item.message, serverId: crypto.randomUUID(), status: 'sent', error: null };
    };
    const flushed = await service.flushOutbox();
    assert.strictEqual(flushed.sent, 1);
    assert.deepStrictEqual(attempts, [a1.clientId, b1.clientId]);
    assert.ok(service.local.getOutbox().some((item) => item.id === a2.clientId));
    assert.ok(!service.local.getOutbox().some((item) => item.id === b1.clientId));

    // Missing cloud migrations are a retryable setup state. The authenticated
    // local snapshot remains attached and is returned with the failure.
    const missingService = new ChatService({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'publishable-test-key',
      localRoot: path.join(root, 'missing-service'),
      getAccessToken: async () => 'token',
      getPublicSession: () => ({ authenticated: true, user: { id: USER_ID, email: 'a@example.com' } }),
      fetchImpl: global.fetch
    });
    missingService._ensureClient = async () => ({});
    missingService.checkCloudDependencies = async () => {
      throw Object.assign(new Error('Could not find the function public.chat_service_status in the schema cache'), { code: 'PGRST202' });
    };
    const missingResult = await missingService.sync();
    assert.strictEqual(missingResult.ok, false);
    assert.strictEqual(missingResult.reason, 'setup-required');
    assert.strictEqual(missingResult.state.authenticated, true);
    assert.strictEqual(missingResult.state.status, 'setup-required');
    assert.strictEqual(missingResult.state.cloud.rpcReady, false);

    // A partial deployment can still provide durable REST synchronization.
    // It must not claim realtime or image upload availability.
    const partialService = new ChatService({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'publishable-test-key',
      localRoot: path.join(root, 'partial-service'),
      getAccessToken: async () => 'token',
      getPublicSession: () => ({ authenticated: true, user: { id: USER_ID, email: 'a@example.com' } }),
      fetchImpl: global.fetch
    });
    partialService._ensureClient = async () => ({});
    partialService.local.useUser(USER_ID);
    partialService.checkCloudDependencies = async () => {
      partialService.cloud = {
        schemaVersion: CHAT_SCHEMA_VERSION,
        rpcReady: true,
        messagesReady: true,
        recallReady: false,
        imageStorageReady: false,
        realtimeConfigured: false,
        realtimeConnected: false
      };
      return { ...partialService.cloud };
    };
    partialService.syncBootstrap = async () => ({
      profile: { id: USER_ID, messsId: 'MSS-11111111', displayName: 'Alice' },
      friends: [], requests: [], conversations: []
    });
    partialService._loadRemoteMessages = async () => [];
    partialService.flushOutbox = async () => ({ ok: true, sent: 0 });
    const partialState = await partialService.syncRemote();
    assert.strictEqual(partialState.status, 'sync-only');
    assert.strictEqual(partialState.cloud.realtimeConnected, false);
    assert.strictEqual(partialState.cloud.imageStorageReady, false);
    assert.match(partialState.lastError, /图片云端存储尚未启用/);

    // A channel timeout resolves as sync-only. Only the actual SUBSCRIBED
    // callback is allowed to promote the service to realtime-online.
    const realtimeService = new ChatService({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'publishable-test-key',
      localRoot: path.join(root, 'realtime-service'),
      getAccessToken: async () => 'token',
      getPublicSession: () => ({ authenticated: true, user: { id: USER_ID, email: 'a@example.com' } }),
      fetchImpl: global.fetch,
      realtimeSubscribeTimeoutMs: 20
    });
    let realtimeCallback;
    const realtimeRegistrations = [];
    const fakeChannel = {
      on(type, filter, callback) {
        realtimeRegistrations.push({ type, filter, callback });
        return this;
      },
      subscribe(callback) {
        realtimeCallback = callback;
        queueMicrotask(() => callback('TIMED_OUT'));
        return this;
      }
    };
    realtimeService.clientUserId = USER_ID;
    realtimeService.local.useUser(USER_ID);
    realtimeService.client = {
      channel: () => fakeChannel,
      removeChannel: async () => {}
    };
    realtimeService.cloud.realtimeConfigured = true;
    assert.strictEqual(await realtimeService._subscribe(), false);
    assert.strictEqual(realtimeService.cloud.realtimeConnected, false);
    assert.notStrictEqual(realtimeService.status, 'online');
    assert.ok(realtimeRegistrations.some((entry) => (
      entry.type === 'postgres_changes'
      && entry.filter.table === 'chat_messages'
      && entry.filter.event === 'UPDATE'
    )));
    realtimeCallback('SUBSCRIBED');
    assert.strictEqual(realtimeService.status, 'online');
    assert.strictEqual(realtimeService.cloud.realtimeConnected, true);

    const dependencyService = new ChatService({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'publishable-test-key',
      localRoot: path.join(root, 'dependency-service'),
      getAccessToken: async () => 'token',
      getPublicSession: () => ({ authenticated: true, user: { id: USER_ID, email: 'a@example.com' } }),
      fetchImpl: global.fetch
    });
    dependencyService.local.useUser(USER_ID);
    const legacyChecked = await dependencyService.checkCloudDependencies({
      rpc: async () => ({
        data: {
          schema_version: CHAT_SCHEMA_VERSION,
          rpc_ready: true,
          messages_ready: true,
          image_storage: true,
          realtime: true
        },
        error: null
      })
    });
    assert.strictEqual(legacyChecked.recallReady, false);
    assert.strictEqual(dependencyService.status, 'idle');
    const legacyRecall = await dependencyService.recallMessage('50000000-0000-4000-8000-000000000099');
    assert.strictEqual(legacyRecall.ok, false);
    assert.strictEqual(legacyRecall.reason, 'recall-unavailable');
    const legacyQuery = { selected: '', orderedBy: '' };
    await dependencyService._loadRemoteMessages({
      from: () => ({
        select(columns) { legacyQuery.selected = columns; return this; },
        order(column) { if (!legacyQuery.orderedBy) legacyQuery.orderedBy = column; return this; },
        range: async () => ({ data: [], error: null })
      })
    }, null);
    assert.strictEqual(legacyQuery.orderedBy, 'created_at');
    assert.doesNotMatch(legacyQuery.selected, /recalled_at|updated_at/);

    const checked = await dependencyService.checkCloudDependencies({
      rpc: async (name) => {
        assert.strictEqual(name, 'chat_service_status');
        return {
          data: {
            schema_version: CHAT_RECALL_SCHEMA_VERSION,
            rpc_ready: true,
            messages_ready: true,
            recall_ready: true,
            image_storage: true,
            realtime: true
          },
          error: null
        };
      }
    });
    assert.strictEqual(checked.imageStorageReady, true);
    assert.strictEqual(checked.realtimeConfigured, true);
    assert.strictEqual(checked.recallReady, true);
    const recallQuery = { selected: '', orderedBy: '' };
    await dependencyService._loadRemoteMessages({
      from: () => ({
        select(columns) { recallQuery.selected = columns; return this; },
        order(column) { if (!recallQuery.orderedBy) recallQuery.orderedBy = column; return this; },
        range: async () => ({ data: [], error: null })
      })
    }, null);
    assert.strictEqual(recallQuery.orderedBy, 'updated_at');
    assert.match(recallQuery.selected, /updated_at,recalled_at,recalled_by/);

    // Recall uses the immutable server message ID, is sender-only, redacts the
    // durable local row, and removes both local and remote image copies.
    dependencyService.local.applyBootstrap({
      profile: { id: USER_ID, displayName: 'Alice' },
      friends: [{ id: FRIEND_ID, displayName: 'Bob' }],
      requests: [],
      conversations: [{ id: CONVERSATION_A, other: { id: FRIEND_ID, displayName: 'Bob' } }]
    });
    const recallClientId = '50000000-0000-4000-8000-000000000001';
    const recallServerId = '50000000-0000-4000-8000-000000000002';
    const recallImagePath = `${CONVERSATION_A}/${USER_ID}/${recallClientId}.png`;
    const recallLocalPath = await dependencyService.local.cacheImageFromFile(recallClientId, source, '.png');
    dependencyService.local.upsertMessage(message(recallClientId, CONVERSATION_A, stamp, {
      serverId: recallServerId,
      kind: 'image',
      body: '',
      imagePath: recallImagePath,
      imageMime: 'image/png',
      imageWidth: 32,
      imageHeight: 24,
      localImagePath: recallLocalPath
    }));
    const recalledStoragePaths = [];
    let recalledRpcCall = null;
    dependencyService._ensureClient = async () => ({
      rpc: async (name, parameters) => {
        recalledRpcCall = { name, parameters };
        return {
          data: {
            id: recallServerId,
            client_message_id: recallClientId,
            conversation_id: CONVERSATION_A,
            sender_id: USER_ID,
            kind: 'image',
            body: null,
            image_path: null,
            image_mime: null,
            image_width: null,
            image_height: null,
            created_at: stamp,
            updated_at: '2026-08-04T10:01:00.000Z',
            recalled_at: '2026-08-04T10:01:00.000Z',
            recalled_by: USER_ID
          },
          error: null
        };
      },
      storage: {
        from: (bucket) => {
          assert.strictEqual(bucket, 'chat-images');
          return {
            remove: async (paths) => {
              recalledStoragePaths.push(paths);
              return { data: [], error: null };
            }
          };
        }
      }
    });
    const recallResult = await dependencyService.recallMessage(recallClientId);
    assert.strictEqual(recallResult.ok, true);
    assert.deepStrictEqual(recalledRpcCall, {
      name: 'recall_chat_message',
      parameters: { p_message_id: recallServerId }
    });
    assert.deepStrictEqual(recalledStoragePaths, [[recallImagePath]]);
    assert.strictEqual(fs.existsSync(recallLocalPath), false);
    assert.strictEqual(dependencyService.local.getMessage(recallClientId).status, 'recalled');
    assert.strictEqual(dependencyService.local.getMessage(recallClientId).imagePath, null);

    const otherClientId = '50000000-0000-4000-8000-000000000003';
    dependencyService.local.upsertMessage(message(otherClientId, CONVERSATION_A, stamp, {
      senderId: FRIEND_ID
    }));
    const forbiddenRecall = await dependencyService.recallMessage(otherClientId);
    assert.strictEqual(forbiddenRecall.ok, false);
    assert.strictEqual(forbiddenRecall.reason, 'recall-forbidden');

    // Image uploads are immutable. RPC failures request cleanup for an object
    // uploaded by this attempt without replacing the original send error.
    const imageMessage = {
      ...message('20000000-0000-4000-8000-000000000001', CONVERSATION_A, stamp, {
        status: 'queued', kind: 'image', body: '', imageMime: 'image/png', imageWidth: 32, imageHeight: 24
      })
    };
    const imageFile = path.join(root, 'outbox-image.png');
    fs.writeFileSync(imageFile, Buffer.from('image-bytes'));
    const uploadOptions = [];
    const cleanupPaths = [];
    const imageBucket = {
      upload: async (_objectPath, _bytes, options) => {
        uploadOptions.push(options);
        return { data: { path: _objectPath }, error: null };
      },
      remove: async (paths) => { cleanupPaths.push(paths); return { data: [], error: null }; }
    };
    await assert.rejects(
      () => dependencyService._sendOutboxItem({
        storage: { from: (bucket) => { assert.strictEqual(bucket, 'chat-images'); return imageBucket; } },
        rpc: async () => ({ data: null, error: { code: 'P0001', message: 'RPC rejected' } })
      }, { message: imageMessage, localImagePath: imageFile }),
      /RPC rejected/
    );
    assert.strictEqual(uploadOptions[0].upsert, false);
    assert.deepStrictEqual(cleanupPaths, [[
      `${CONVERSATION_A}/${USER_ID}/${imageMessage.clientId}.png`
    ]]);

    let retryRpcCalled = false;
    const retried = await dependencyService._sendOutboxItem({
      storage: { from: () => ({
        upload: async () => ({ data: null, error: { statusCode: 409, message: 'The resource already exists' } }),
        remove: async () => { throw new Error('successful retries must not clean up'); }
      }) },
      rpc: async () => {
        retryRpcCalled = true;
        return {
          data: {
            id: '20000000-0000-4000-8000-000000000002',
            client_message_id: imageMessage.clientId,
            conversation_id: imageMessage.conversationId,
            sender_id: imageMessage.senderId,
            kind: 'image', body: null,
            image_path: `${CONVERSATION_A}/${USER_ID}/${imageMessage.clientId}.png`,
            image_mime: 'image/png', image_width: 32, image_height: 24,
            created_at: stamp
          },
          error: null
        };
      }
    }, { message: imageMessage, localImagePath: imageFile });
    assert.strictEqual(retryRpcCalled, true);
    assert.strictEqual(retried.status, 'sent');

    await assert.rejects(
      () => dependencyService._sendOutboxItem({
        storage: { from: () => ({
          upload: async () => ({ data: { path: 'uploaded' }, error: null }),
          remove: async () => { throw new Error('cleanup failed'); }
        }) },
        rpc: async () => ({ data: null, error: { code: 'P0001', message: 'original send failure' } })
      }, { message: imageMessage, localImagePath: imageFile }),
      /original send failure/
    );

    local.flushCheckpoint();
    restarted.flushCheckpoint();
    await service.close();
    await missingService.close();
    await partialService.close();
    await realtimeService.close();
    await dependencyService.close();
    assert.strictEqual(fs.readFileSync(path.join(root, 'users', USER_ID, 'events.v1.jsonl'), 'utf8'), '');
    assert.strictEqual(fs.existsSync(path.join(root, 'users', USER_ID, 'history.v1.json.bak')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '202608040001_realtime_chat.sql'),
    'utf8'
  );
  assert.match(migration, /alter table public\.chat_messages enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /values\s*\(\s*'chat-images',\s*'chat-images',\s*false/i);
  assert.match(migration, /chat_messages_client_message_id_uidx[\s\S]*?\(client_message_id\)/i);
  assert.match(migration, /duplicate chat client message ids must be resolved before schema v2/i);
  assert.doesNotMatch(migration, /unique \(sender_id, client_message_id\)/i);
  assert.match(migration, /on conflict \(client_message_id\) do nothing/i);
  assert.match(migration, /sender_id is distinct from auth\.uid\(\)[\s\S]*?belongs to another sender/i);
  assert.match(migration, /lower\(p\.email\) = lower\(btrim\(p_query\)\)/i);
  assert.doesNotMatch(migration, /lower\(p\.email\)\s+(?:i?like)/i);
  assert.match(migration, /using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(migration, /create or replace function public\.is_chat_conversation_member\(p_conversation_id uuid\)/i);
  assert.doesNotMatch(migration, /create or replace function public\.is_chat_conversation_member\(p_conversation_id uuid,\s*p_user_id uuid\)/i);
  assert.match(migration, /grant execute on function public\.is_chat_conversation_member\(uuid\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.is_chat_conversation_member\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /client message id was already used with different content/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /create or replace function public\.chat_service_status\(\)/i);
  assert.match(migration, /'schema_version',\s*2/i);
  assert.match(migration, /grant execute on function public\.chat_service_status\(\) to authenticated/i);
  assert.match(migration, /file_size_limit\s*=\s*excluded\.file_size_limit/i);
  assert.match(migration, /'chat-images',\s*'chat-images',\s*false,\s*52428800/i);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff', 'image/bmp']) {
    assert.ok(migration.includes(`'${mime}'`), `missing chat image MIME ${mime}`);
  }
  assert.match(migration, /create policy chat_images_insert_owner[\s\S]*?for insert to authenticated/i);
  assert.match(migration, /create policy chat_images_delete_orphan_owner[\s\S]*?for delete to authenticated/i);
  assert.match(migration, /not exists \([\s\S]*?chat_messages m where m\.image_path = storage\.objects\.name/i);
  assert.doesNotMatch(migration, /create policy chat_images_[^\r\n]+[\s\S]{0,80}?for update/i);
  assert.match(migration, /required_realtime\(relname\)[\s\S]*?'chat_messages'[\s\S]*?'chat_friend_requests'[\s\S]*?'chat_friendships'[\s\S]*?'chat_conversation_members'/i);
  assert.match(migration, /substr\(replace\(p_id::text, '-', ''\), 1, 16\)/i);

  const recallMigration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '202608080002_chat_message_recall.sql'),
    'utf8'
  );
  assert.match(recallMigration, /add column if not exists updated_at timestamptz not null default now\(\)/i);
  assert.match(recallMigration, /add column if not exists recalled_at timestamptz/i);
  assert.match(recallMigration, /add column if not exists recalled_by uuid/i);
  assert.match(recallMigration, /create or replace function public\.recall_chat_message\(p_message_id uuid\)/i);
  assert.match(recallMigration, /v_message\.sender_id is distinct from auth\.uid\(\)[\s\S]*?only the sender can recall/i);
  assert.match(recallMigration, /set[\s\S]*?body = null[\s\S]*?image_path = null[\s\S]*?recalled_at = now\(\)[\s\S]*?recalled_by = auth\.uid\(\)/i);
  assert.match(recallMigration, /revoke all on function public\.recall_chat_message\(uuid\) from public, anon, authenticated/i);
  assert.match(recallMigration, /grant execute on function public\.recall_chat_message\(uuid\) to authenticated/i);
  assert.match(recallMigration, /'schema_version',\s*3/i);
  assert.match(recallMigration, /'recall_ready'/i);

  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'chat-service.js'), 'utf8');
  assert.match(serviceSource, /const CHAT_SCHEMA_VERSION = 2/);
  assert.match(serviceSource, /const CHAT_RECALL_SCHEMA_VERSION = 3/);
  assert.match(serviceSource, /upsert:\s*false/);
  assert.match(serviceSource, /await imageBucket\.remove\(\[uploadedImagePath\]\)/);
  assert.match(serviceSource, /event:\s*'UPDATE'[\s\S]*?table:\s*'chat_messages'/);
  assert.match(serviceSource, /client\.rpc\('recall_chat_message'/);
  assert.match(serviceSource, /CHAT_MESSAGE_COLUMNS_V3 = `\$\{CHAT_MESSAGE_COLUMNS_V2\},updated_at,recalled_at,recalled_by`/);
  assert.match(serviceSource, /const incoming = !existing && !message\.recalledAt && message\.senderId !== this\.clientUserId/);
  assert.match(serviceSource, /incomingMessages\.forEach\(\(message\) => this\._emit\('message'/);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSource, /if \(supabaseAuth\.getPublicSession\(\)\.authenticated\) \{\s*chatService\.initialize\(\)/);
  assert.match(mainSource, /ipcMain\.handle\('chat:recallMessage',[\s\S]*?chatService\.recallMessage\(clientId\)/);

  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preloadSource, /recallChatMessage:\s*\(clientId\)\s*=>\s*ipcRenderer\.invoke\('chat:recallMessage', clientId\)/);
  assert.match(preloadSource, /onOpenChatConversation:[\s\S]*?ipcRenderer\.on\('chat:openConversation'/);

  const fileMigration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '202608140001_chat_files.sql'),
    'utf8'
  );
  assert.match(fileMigration, /add column if not exists file_path text/i);
  assert.match(fileMigration, /kind in \('text', 'image', 'file'\)/i);
  assert.match(fileMigration, /'chat-files', 'chat-files', false, 104857600/i);
  assert.match(fileMigration, /'schema_version', 4/i);
  assert.match(serviceSource, /async sendFile\(conversationId, sourcePath\)/);
  assert.match(serviceSource, /fileMime:\s*chatFileMime\(fileName\)/);
  assert.match(serviceSource, /async createGroup\(name, memberIds\)/);
  assert.match(serviceSource, /client\.rpc\('create_chat_group'/);
  assert.match(serviceSource, /async addGroupMembers\(conversationId, memberIds\)/);
  assert.match(serviceSource, /client\.storage\.from\('chat-files'\)/);
  assert.match(mainSource, /ipcMain\.handle\('chat:sendFile'/);
  assert.match(mainSource, /desktopCapturer\.getSources/);
  assert.match(mainSource, /require\('electron-screenshots'\)/);
  assert.match(mainSource, /new ElectronScreenshots\([\s\S]*?singleWindow:\s*true/,
    'The mature screenshot window must be reused to avoid repeated startup lag.');
  assert.match(mainSource, /captureChatScreenshotWithNativeTool[\s\S]*?createChatScreenshotDraftFromBuffer/);
  assert.match(mainSource, /CHAT_SCREENSHOT_START_TIMEOUT_MS[\s\S]*?capture-start-timeout[\s\S]*?captureChatScreenshotDraftLegacy/,
    'A stalled native capture must time out and fall back instead of disabling screenshot forever.');
  assert.match(mainSource, /captureChatScreenshotDraft[\s\S]*?captureChatScreenshotDraftLegacy/,
    'Native screenshot failures must retain the Electron compatibility fallback.');
  assert.match(mainSource, /pngSignature !== '89504e470d0a1a0a'/,
    'Screenshot drafts must validate PNG bytes before entering chat.');
  assert.match(mainSource, /ipcMain\.handle\('chat:captureScreenshotDraft'/);
  assert.match(mainSource, /createChatAttachmentDraft/);
  const chatDraftSource = mainSource.slice(
    mainSource.indexOf('async function createChatAttachmentDraft'),
    mainSource.indexOf('async function discardChatAttachmentDraft')
  );
  assert.doesNotMatch(chatDraftSource, /\bmodelId\b/,
    'Chat attachment drafts must not reference an undefined AI model variable.');
  assert.match(mainSource, /ipcMain\.handle\('chat:createBoardAttachmentDrafts'[\s\S]*?store\.getFile\(id\)[\s\S]*?createChatAttachmentDraft/);
  assert.match(mainSource, /ipcMain\.handle\('chat:readClipboardDrafts'/);
  assert.match(mainSource, /ipcMain\.handle\('clipboard:copyBoardMedia'/);
  assert.match(mainSource, /protocol\.handle\('messs-chat-file'/);
  assert.doesNotMatch(mainSource, /chat:sendScreenshot/);
  assert.match(preloadSource, /sendChatFile:\s*\(conversationId\)\s*=>\s*ipcRenderer\.invoke\('chat:sendFile', conversationId\)/);
  assert.match(preloadSource, /captureChatScreenshotDraft:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('chat:captureScreenshotDraft'\)/);
  assert.match(preloadSource, /sendChatAttachmentDraft:/);
  assert.match(preloadSource, /createChatBoardAttachmentDrafts:[\s\S]*?chat:createBoardAttachmentDrafts/);
  const chatUiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'chat.js'), 'utf8');
  const contextMenuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'context-menu.js'), 'utf8');
  const emojiLoaderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'emoji-picker-loader.js'), 'utf8');
  assert.match(emojiLoaderSource, /emoji-picker-element\/index\.js/);
  assert.match(chatUiSource, /addEventListener\('emoji-click'/,
    'Chat emoji selection should come from the standard picker component.');
  assert.doesNotMatch(chatUiSource, /const CHAT_EMOJI = /,
    'Chat should not keep a manually curated emoji list.');
  assert.doesNotMatch(chatUiSource, /messsId/);
  assert.match(chatUiSource, /bubble\.textContent = t\('Message recalled', '消息已撤回'\)/);
  assert.match(chatUiSource, /window\.messsAPI\.recallChatMessage\(message\.clientId\)/);
  assert.match(chatUiSource, /window\.messsAPI\.onOpenChatConversation\([\s\S]*?openChatConversation\(conversationId\)/);

  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(indexSource, /data-chat-view="messages"/);
  assert.match(indexSource, /id="chat-emoji-btn"/);
  assert.match(indexSource, /<emoji-picker[^>]+id="chat-emoji-popover"[^>]+data-source="assets\/emoji-data-en\.json"/,
    'Chat should use the bundled standard emoji picker and data.');
  assert.match(indexSource, /id="chat-file-btn"/);
  assert.match(indexSource, /id="chat-screenshot-btn"/);
  assert.match(indexSource, /id="chat-new-group-btn"/);
  assert.match(indexSource, /id="chat-group-modal"/);
  assert.match(indexSource, /id="chat-attachment-tray"/);
  assert.match(chatUiSource, /pendingAttachments/);
  assert.match(chatUiSource, /queueBoardMediaToChat[\s\S]*?createChatBoardAttachmentDrafts[\s\S]*?addChatAttachmentDrafts/);
  assert.match(chatUiSource, /preserveAttachmentsForConversationChange[\s\S]*?openChatConversation/,
    'Canvas attachments must survive choosing either a direct or group conversation.');
  assert.match(contextMenuSource, /Send to Chat[\s\S]*?sendBoardMediaToChat/);
  assert.match(contextMenuSource, /key: 'send-chat'[\s\S]*?isImageExt\(file\.ext\) \|\| isVideoExt\(file\.ext\)/);
  assert.match(chatUiSource, /readChatClipboardDrafts\(\)/);
  assert.match(chatUiSource, /pasteChatClipboardAttachments[\s\S]*?event\.preventDefault\(\)[\s\S]*?readChatClipboardDrafts\(\)[\s\S]*?restoreChatClipboardText/,
    'Chat paste must inspect native CF_HDROP before falling back to text.');
  assert.doesNotMatch(chatUiSource, /pasteChatClipboardAttachments[\s\S]{0,400}?if \(!hasFiles\) return/,
    'Canvas media paste must not depend on Chromium clipboard file items.');
  assert.match(chatUiSource, /captureChatScreenshotDraft\(\)/);
  assert.match(chatUiSource, /messs-chat-file:\/\/\$\{message\.clientId\}/);
  assert.doesNotMatch(chatUiSource, /sendChatScreenshot\(/);
  const groupMigration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '202608170002_chat_groups.sql'),
    'utf8'
  );
  assert.match(groupMigration, /create or replace function public\.create_chat_group\(p_name text, p_member_ids uuid\[\]\)/i);
  assert.match(groupMigration, /only friends can be invited/i);
  assert.match(groupMigration, /owner_id = auth\.uid\(\)/i);
  assert.match(groupMigration, /'schema_version', 5/i);
  assert.match(groupMigration, /'group_ready', true/i);
  const chatCssSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'chat.css'), 'utf8');
  assert.match(chatCssSource, /grid-template-columns:\s*64px\s+clamp\(248px, 19vw, 286px\)\s+minmax\(380px, 1fr\)/);
  assert.match(chatCssSource, /\.chat-shell \{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\)/,
    'The chat shell row must not grow beyond the application viewport.');
  assert.match(chatCssSource, /\.chat-thread \{[\s\S]*?grid-template-rows:\s*62px\s+minmax\(0, 1fr\)[\s\S]*?overflow:\s*hidden/,
    'Chat history must scroll without pushing the composer off screen.');
  assert.match(chatCssSource, /grid-template-rows:\s*62px\s+minmax\(0, 1fr\)\s+clamp\(230px, 30vh, 310px\)/);
  assert.match(chatCssSource, /\.chat-composer-toolbar[\s\S]*?padding:\s*8px 12px 10px/);
  assert.match(chatCssSource, /\.chat-emoji-popover[\s\S]*?max-height:\s*min\(400px/);
  assert.match(chatCssSource, /\.chat-emoji-popover[\s\S]*?--num-columns:\s*10/,
    'The emoji picker should use a larger desktop grid.');
  assert.match(chatCssSource, /\.chat-emoji-popover[\s\S]*?--emoji-size:\s*30px/,
    'Picker emoji should remain visually prominent.');
  assert.match(chatCssSource, /\.chat-emoji-popover::\-webkit-scrollbar-thumb/,
    'The emoji picker scrollbar should use the application theme.');
  assert.match(chatCssSource, /\.chat-tool-button\[aria-expanded="true"\]/,
    'The emoji trigger should expose a clear active state.');
  const chatMarkup = indexSource.match(/<div id="section-chat"[\s\S]*?<div id="section-market"/i)[0];
  assert.doesNotMatch(chatMarkup, /chat-own-id|chat-contacts-toggle|chat-contacts-close/i);
  assert.doesNotMatch(chatMarkup, /chat-account-head|chat-own-avatar|chat-sync-btn/i);
  const chatNavMarkup = chatMarkup.match(/<nav class="chat-nav-rail"[\s\S]*?<\/nav>/i)[0];
  assert.doesNotMatch(chatNavMarkup, /<span>Messages<\/span>|<span>Contacts<\/span>|<span>Moments<\/span>/i);
  assert.match(chatMarkup, /id="chat-send-btn"[\s\S]*?chat-send-logo[\s\S]*?chat-send-divider[\s\S]*?<path d="M12 19V5"/i);
  assert.match(chatMarkup, /chat-people-panel[\s\S]*chat-user-search-form[\s\S]*chat-conversations-panel[\s\S]*<\/aside>\s*<main class="chat-thread-panel"/i);
  assert.match(chatUiSource, /function refreshChatOwnAvatar[\s\S]*?window\.messsAPI\.getProfileAvatar\(\)/);
  assert.match(chatUiSource, /function chooseChatOwnAvatar[\s\S]*?window\.messsAPI\.chooseProfileAvatar\(\)[\s\S]*?messs:profile-avatar-updated/);
  assert.match(chatUiSource, /showChatAvatarContextMenu[\s\S]*?Change profile image[\s\S]*?chat-avatar-context-menu/);
  assert.match(chatUiSource, /function renderChatAvatarElement[\s\S]*?document\.createElement\('img'\)[\s\S]*?classList\.add\('has-image'\)/);
  assert.match(chatMarkup, /id="chat-profile-modal"[\s\S]*?id="chat-reader-modal"[\s\S]*?id="chat-forward-modal"/,
    'Chat should include account, enlarged-reading, and forwarding dialogs.');
  assert.match(chatMarkup, /id="chat-multi-select-bar"[\s\S]*?id="chat-multi-copy"[\s\S]*?id="chat-multi-forward"[\s\S]*?id="chat-multi-delete"/,
    'Chat should expose batch operations while messages are selected.');
  assert.match(chatUiSource, /function chatMessageProfile[\s\S]*?conversation\.members[\s\S]*?message\.senderId/,
    'Incoming group messages should resolve the sender profile.');
  assert.match(chatUiSource, /avatar\.className = 'chat-avatar chat-message-avatar'[\s\S]*?avatar\.addEventListener\('click'[\s\S]*?openChatProfileModal/,
    'Every message avatar should open the account dialog when clicked.');
  assert.match(chatUiSource, /showChatMessageContextMenu[\s\S]*?Copy', '复制'[\s\S]*?Enlarge reading', '放大阅读'[\s\S]*?Translate', '翻译'[\s\S]*?Search', '搜索'[\s\S]*?Forward', '转发'[\s\S]*?Favorite', '收藏'[\s\S]*?Multi-select', '多选'[\s\S]*?Reminder', '提醒'[\s\S]*?Quote', '引用'[\s\S]*?Delete', '删除'/,
    'The text-message context menu should keep the requested action order.');
  assert.match(chatUiSource, /messs-chat-message-preferences:[\s\S]*?favoriteMessageIds[\s\S]*?hiddenMessageIds[\s\S]*?reminders/,
    'Favorites, local deletion, and reminders should be isolated and persisted per user.');
  assert.match(chatUiSource, /openChatForwardModal[\s\S]*?window\.messsAPI\.sendChatText\(conversation\.id, ChatUiState\.pendingForwardText\)/,
    'Forwarding should send the selected text through the existing synchronized chat API.');
  assert.match(chatUiSource, /deleteChatMessage[\s\S]*?recallChatMessage\(message,[\s\S]*?hideChatMessageLocally/,
    'Deleting an owned synchronized message should recall it while other deletion remains local.');
  assert.match(chatCssSource, /\.chat-message-avatar[\s\S]*?\.chat-message-main/,
    'Message rows should reserve stable space for avatars and content.');
  assert.match(chatCssSource, /\[data-theme="light"\] \.chat-section \{[\s\S]*?--chat-nav-surface:\s*#e3e4e8;[\s\S]*?--chat-list-surface:\s*#e9eaed;/);
  assert.match(chatCssSource, /\.chat-send-button \{[\s\S]*?width:\s*78px;[\s\S]*?background:\s*var\(--chat-button-gradient\)/);

  process.stdout.write('Chat persistence and validation tests passed.\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
