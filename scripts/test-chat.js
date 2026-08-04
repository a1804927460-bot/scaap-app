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
  normalizeBootstrap,
  publicFailure,
  CHAT_SCHEMA_VERSION
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
  assert.strictEqual(normalizeBootstrap({ friends: [{ id: FRIEND_ID, relationship_status: 'friend' }] }).friends[0].relationshipStatus, 'friend');
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
    const restarted = new ChatLocalStore(root);
    restarted.useUser(USER_ID);
    assert.strictEqual(restarted.getMessage(queuedId).status, 'queued');
    assert.strictEqual(restarted.getOutbox().length, 1);

    // Images are copied into the versioned, per-user managed directory.
    const source = path.join(root, 'source.png');
    fs.writeFileSync(source, Buffer.from('image-bytes'));
    const managed = await restarted.cacheImageFromFile(queuedId, source, '.png');
    assert.strictEqual(fs.readFileSync(managed, 'utf8'), 'image-bytes');
    assert.ok(managed.startsWith(path.join(root, 'users', USER_ID, 'images')));

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
    const fakeChannel = {
      on() { return this; },
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
    const checked = await dependencyService.checkCloudDependencies({
      rpc: async (name) => {
        assert.strictEqual(name, 'chat_service_status');
        return {
          data: {
            schema_version: CHAT_SCHEMA_VERSION,
            rpc_ready: true,
            messages_ready: true,
            image_storage: true,
            realtime: true
          },
          error: null
        };
      }
    });
    assert.strictEqual(checked.imageStorageReady, true);
    assert.strictEqual(checked.realtimeConfigured, true);

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

  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'chat-service.js'), 'utf8');
  assert.match(serviceSource, /const CHAT_SCHEMA_VERSION = 2/);
  assert.match(serviceSource, /upsert:\s*false/);
  assert.match(serviceSource, /await imageBucket\.remove\(\[uploadedImagePath\]\)/);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSource, /if \(supabaseAuth\.getPublicSession\(\)\.authenticated\) \{\s*chatService\.initialize\(\)/);

  process.stdout.write('Chat persistence and validation tests passed.\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
