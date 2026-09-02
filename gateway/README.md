# Messs AI Gateway

This Railway service keeps upstream AI credentials out of the Electron application.
It validates Supabase access tokens, applies per-user and per-IP limits, reserves a
durable daily quota in Supabase, maps provider IDs to server-owned endpoints, and
returns normalized chat or media responses.

## Trust boundary

- The client may send a provider ID, prompt, model choice, and sanitized references.
- The client may not send an upstream endpoint or upstream API key.
- `SUPABASE_SECRET_KEY` and every provider key are Railway sealed variables.
- Request logs never include prompts, attachments, authorization headers, or upstream bodies.
- Browser origins are denied unless explicitly listed in `ALLOWED_ORIGINS`.

## Local check

```powershell
npm --prefix gateway install
npm --prefix gateway run check
npm --prefix gateway start
```

`GET /healthz` is public. Every `/v1/*` route requires a Supabase user access token:

```text
Authorization: Bearer <short-lived-supabase-access-token>
```

QuickRouter is the built-in relay. Store its key as the sealed Railway variable
`QUICKROUTER_API_KEY`. The temporary aliases `QUICK_API_KEY` and `Quick_API_KEY`
are accepted during migration, but the canonical name is recommended.

## Mixed AI Reiter routing

Set `AIREITER_API_KEY` as a sealed Railway variable to enable AI Reiter for
Nano Banana Pro, GPT Image 2, Midjourney V8.1, MiniMax H3, Seedance 2.0/2.5,
Kling V3/O3, and Agent chat. ChaserPro is intentionally unchanged.

`AIREITER_TRAFFIC_PERCENT` controls the percentage of supported requests that
try AI Reiter first and defaults to `60`. Existing upstreams receive the rest
of the traffic and stay available as safe fallbacks, allowing existing balances
to be consumed during migration. Set it to `0` to disable AI Reiter or `100` to
make it the first route. Per-product overrides are also supported:

```text
AIREITER_TRAFFIC_JSON={"image-1":70,"video-1":50,"chat-1":60}
```

Route selection is deterministic from the operation ID, so a retry keeps the
same first route. Once an upstream accepts a task, polling and recovery remain
pinned to that route and the paid request is never submitted elsewhere.

Set `PROVIDER_USER_HASH_SECRET` to a separate stable random secret. The gateway
turns each authenticated Supabase user ID into a stable anonymous value such as
`u_4f0c...`. Compatible generation and Agent requests carry that value, which
separates upstream usage by user without exposing email addresses, Google
profile data, names, or raw Supabase UUIDs. Keep the secret unchanged across
deploys so account identities remain stable.

MiniMax H3 uses AI Reiter for all new requests when
`AIREITER_TRAFFIC_JSON` contains `"minimax-h3":100` (or `"video-1":100`).
The older MiniMax route remains available only as a safe fallback after a
provable pre-acceptance rejection; accepted or ambiguous paid tasks are never
replayed. The public product name remains MiniMax H3, and upstream credentials
are never written to `runtime.json`, GitHub, desktop settings, or responses.
Legnext Midjourney V8.1 and V8.2 use the sealed Railway variable
`LEGNEXT_API_KEY`. The key is sent only in the gateway's `x-api-key` request
header; task polling is performed server-side against the private job URL and
the key is never returned to the desktop.

AtlasCloud is the preferred provider for GPT Image 2, Seedance 2.0/2.5,
and Butler 3D generation. Store its credential as the sealed Railway variable
`ATLASCLOUD_API_KEY`.
The catalog includes GPT Image 2 text-to-image and edit, Seedance image-to-video,
reference-to-video, first/last-frame, audio references, Seedance 2.5 video edit
and extension, and 30-second generation where the upstream model supports it.
AtlasCloud is selected only when this variable is present; otherwise the gateway
fails closed for those provider IDs and keeps the existing 302/QuickRouter
providers available as configured fallbacks. Never put the key in the desktop
bundle, `runtime.json`, provider catalog, or client-visible responses.

## Butler tools

Butler uses the 302 tool gateway for background removal and Topaz video
enhancement. 3D generation uses Atlas Cloud when `ATLASCLOUD_API_KEY` is
configured, while existing 302 task tokens remain readable during migration.
Store the legacy shared credential as the sealed Railway variable `AI302_KEY`. The compatibility
alias `AI_302_API_KEY` is accepted during migration. The gateway applies the
upstream authorization header internally; the credential is never sent to the
desktop, returned by an API response, or written to logs.

Every paid route is fail-closed behind an independent Railway flag. Missing,
empty, or malformed values are treated as `false`:

```text
ENABLE_302_BACKGROUND_REMOVE=true
ENABLE_302_IMAGE_TOOLS=true
ENABLE_302_HUNYUAN3D=true
ENABLE_302_HYPER3D=true
ENABLE_302_TOPAZ=true
```

Keep the flags disabled until the corresponding server-authoritative credit
reservation and settlement flow is deployed. Apply the Butler credit migrations
listed below before enabling Topaz or the other paid tools.

Set `AI302_TASK_SECRET` to a separate, stable random secret. It encrypts and
authenticates asynchronous 3D and video task tokens and binds each token and
provider to its Supabase user. If
it is omitted, the gateway derives the token key from `AI302_KEY`; a later 302
key rotation would then invalidate outstanding 3D tasks, so the separate secret
is recommended in production.

The 302-compatible tools also support optional server-only failover routes. Set
`AI302_BACKUP_ROUTES_JSON` to a JSON array of `{ "id", "baseUrl", "keyEnv" }`
entries and provide each named key as a sealed Railway variable. The gateway
accepts only HTTPS routes and ignores routes without a valid key. Failover is
limited to an explicit 402, 425, or 429 response before a task is accepted; a
timeout, network error, 5xx response, malformed success, or download failure
never submits the same paid request to another route. After a task is accepted,
its encrypted task token pins status and download requests to the route that
created it. These routes must expose the same 302-compatible paths and billing
semantics as the primary route; do not use a different product as a fallback.

All Butler routes require a valid Supabase session:

```text
POST /v1/tools/background/remove
POST /v1/tools/3d/create
POST /v1/tools/3d/status
POST /v1/tools/3d/download
POST /v1/tools/video/upscale
POST /v1/tools/video/status
POST /v1/tools/video/download
```

Background removal accepts JSON `{ "imageDataUrl": "data:image/..." }` and
returns a validated transparent PNG. The 3D create route accepts
`{ "providerId": "hunyuan3d|hyper3d|tripo3d", "imageDataUrl": "data:image/...", "prompt": "..." }`
and returns an opaque task token. Status returns only a normalized state
(`queued`, `processing`, `succeeded`, or `failed`) and never exposes the upstream
job ID or model URL. Download returns a validated GLB binary after completion.
Inputs, redirects, result hosts, byte sizes, PNG integrity, and GLB structure are
checked before any result reaches the desktop.

Apply `supabase/migrations/202608080005_butler_video_credits.sql` before enabling
Topaz video enhancement. The gateway reserves the server-calculated retail
points returned by the provider quote, settles completed jobs, and releases
failed-job reservations.

Apply `supabase/migrations/202608080007_seedance_video_credits.sql` followed by
`supabase/migrations/202608080008_butler_tool_credits.sql` before enabling the
Seedance or Butler image/3D routes. Paid 302 routes remain unavailable until
their matching `ENABLE_302_*` Railway variable is not explicitly set to `false`.
When `AI302_KEY` is present, a missing flag enables the route; setting a flag
to `false` is the emergency kill switch for that specific paid tool.

Hyper3D and Topaz require a public HTTPS URL for their bounded input relay. Configure
`AI_GATEWAY_PUBLIC_URL` to the gateway's public origin. If omitted, Railway's
`RAILWAY_PUBLIC_DOMAIN` is used automatically. The gateway strips image metadata
and stores the bounded input in an in-memory, capability-token-protected relay.
`GET /v1/tools/assets/<opaque-token>` is the only unauthenticated tool route; it
returns only the corresponding media with `no-store` and `nosniff`.
Run a single gateway instance while this in-memory relay is in use, or replace it
with a shared private object store before scaling horizontally.

## Background video jobs

Apply `supabase/migrations/202608080003_async_video_jobs.sql` before deploying a
gateway that contains the asynchronous MiniMax routes. Video generation uses
three authenticated short requests:

```text
POST /v1/media/video/tasks/create
POST /v1/media/video/tasks/status
POST /v1/media/video/tasks/download
```

The create route reserves points and stores only hashed task credentials. A
lease-based Railway worker polls MiniMax independently of the client connection,
and finalizes the job and point charge atomically. The download route returns a
validated temporary HTTPS result URL; the desktop downloads it without sending
the user's Supabase bearer token to the media host. If the async schema is
missing, the worker logs one `video-worker-disabled` event and stops polling
until the service restarts. The legacy `POST /v1/media/video` route remains
available for v0.0.5 clients while they migrate to these task routes.

Use `AI_PROVIDERS_JSON` to register additional relays without rebuilding the
desktop app. The registry supports up to 100 chat, image, and video entries. It
contains only public endpoint metadata and the name of a Railway environment
variable, never the secret value itself. Each relay key must be stored as a
separate sealed Railway variable.

Built-in providers can receive a backup by adding a small override entry with
the same `id` and a `fallbackProviderIds` array. The override inherits the
built-in endpoint, protocol, model, and capability matrix, so it does not need
to duplicate those fields. Each backup entry must be a separate hidden entry
with its own HTTPS endpoint, `keyEnv`, protocol, and matching `logicalModel`.
Only same-kind, same-capability-family entries are eligible. For example:

```json
[
  { "id": "image-1", "fallbackProviderIds": ["image-1-backup"] },
  {
    "id": "image-1-backup",
    "kind": "image",
    "name": "Nano Banana Pro backup",
    "endpoint": "https://backup.example.com/v1beta/models/gemini-3-pro-image-preview:generateContent",
    "keyEnv": "IMAGE_1_BACKUP_KEY",
    "protocol": "gemini-native",
    "logicalModel": "nano-banana-pro",
    "hidden": true
  }
]
```

The same structure applies to every configured image, video, or chat provider.
Failover occurs only when the first route explicitly proves that it rejected
the request before accepting it (`402`, `425`, `429`, or a declared channel
configuration outage). A timeout, network error, `5xx`, malformed success,
accepted task id, or result download failure is state-ambiguous and is never
replayed to another route. Accepted tasks stay pinned to their original route
for polling and recovery. The desktop receives only the public product labels;
provider names, endpoints, keys, route ids, and task ids remain server-side.

```json
[
  {
    "id": "relay-2-image",
    "kind": "image",
    "name": "Relay 2 Image",
    "endpoint": "https://relay.example.com/v1/images/generations?model=gpt-image-1",
    "keyEnv": "RELAY_2_API_KEY"
  },
  {
    "id": "relay-2-chat",
    "kind": "chat",
    "name": "Relay 2 Chat",
    "endpoint": "https://relay.example.com/v1",
    "models": ["model-a", "model-b"],
    "keyEnv": "RELAY_2_API_KEY"
  }
]
```

Only providers whose key variable exists are returned to the desktop app. The
gateway never returns endpoints or secret-variable names to the client.
