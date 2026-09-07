# Generation Recovery Audit (2026-09-07)

## Production Evidence

- Latest recorded image-tool failure: `background-remove`, request
  `01d311ce-6527-457b-b7a8-889ca428a956`, with
  `Maximum call stack size exceeded` before an upstream identity was attached.
- Reproduced locally with a normal 2048x2048 JPEG of about 4.25 MB. The stack
  points to `assertStrictBase64` in `gateway/src/ai302-tools.js`.
- Two historical MiniMax tasks recorded as `video-generation-timeout` were
  actually completed upstream: requests `4cab7ebc-2062-412b-90c4-2d83d48a9623`
  and `159cbde5-e958-48b6-987f-c74013fa207d`. AIReiter query returned completed
  times 09:40:08 and 05:34:55 UTC on September 6, before their local deadlines.
- Latest successful MiniMax task still resolves and downloads a valid 1,426,869
  byte video through the current adapter. The video storage RPC is installed.
- At inspection, no new user generation failure was recorded after the all-model
  mixing deployment. Historical records alone do not establish a new mixed-route
  outage or prove why every old worker stopped making progress.

## Fixes

The repeated four-character Base64 regex group exhausted V8's regex stack on
multi-megabyte payloads. Replace it with a flat character run and optional final
padding; keep length, decoded size, canonical round-trip and media checks. This
repairs shared input validation for reference images, image tools, 3D image
inputs, and inline video uploads without loosening size or format limits.

The video worker previously failed jobs at the local deadline before querying
the accepted upstream task. It now checks accepted tasks even after that deadline,
downloads completed results and persists them before delivery. A provider still
processing after the deadline is polled less frequently; transport/storage
failures remain recoverable. Explicit provider failure can still finalize as
failed. No accepted task is regenerated to work around uncertainty.

Existing failed historical jobs and user balances were not rewritten. These
fixes do not automatically revive an already-failed/refunded job or recharge it.

## Verification

- `npm --prefix gateway run check`: passed, including 10 new regression cases.
- Large real JPEG/PNG/WebP fixtures, an 8 MB video-container validation fixture,
  invalid padding/characters/canonical bits, and size-limit rejection passed.
- Expired completed video, active task, polling outage, storage outage, explicit
  terminal failure and missing task identity are covered with worker/RPC mocks.
- `node scripts/smoke-large-image-tool.mjs --live`: a 7,090,841-byte valid PNG
  was accepted by FAL and produced a 1536x1536 transparent PNG of 2,595,267 bytes.
  This is a real provider test, not an authenticated full desktop delivery test.
- `test-ai-media-persistence.js`, `test-ai-media-fallback.js` and
  `test-gateway-providers.mjs`: passed.
- `stress-generation-queue.mjs`: 2,000 simulated tasks, 100 users, no queued
  tasks left; same-ID overload retry verified. This is not a live upstream
  capacity benchmark.

No image routing percentages, customer prices or video upstreams were changed.
No installer/UI changes are part of this gateway hotfix.
