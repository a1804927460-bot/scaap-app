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
MiniMax H3 uses its own sealed Railway variable, `MINIMAX_API_KEY`. It is never
written to `runtime.json`, GitHub, the desktop settings, or gateway responses.

## Butler tools

Butler uses the 302 tool gateway for background removal, 3D generation, and
Topaz video enhancement. Store the
shared credential as the sealed Railway variable `AI302_KEY`. The compatibility
alias `AI_302_API_KEY` is accepted during migration. The gateway applies the
upstream authorization header internally; the credential is never sent to the
desktop, returned by an API response, or written to logs.

Every paid route is fail-closed behind an independent Railway flag. Missing,
empty, or malformed values are treated as `false`:

```text
ENABLE_302_BACKGROUND_REMOVE=false
ENABLE_302_HUNYUAN3D=false
ENABLE_302_HYPER3D=false
ENABLE_302_TOPAZ=false
```

Keep all four flags disabled until the corresponding server-authoritative
credit reservation and settlement flow is deployed. Background removal and 3D
do not yet have that accounting. Topaz must also remain disabled even if
`202608080005_butler_video_credits.sql` is installed: its upstream quote is
currently returned only after a paid task is created, so the reservation order
must be redesigned before production rollout.

Set `AI302_TASK_SECRET` to a separate, stable random secret. It encrypts and
authenticates asynchronous 3D and video task tokens and binds each token and
provider to its Supabase user. If
it is omitted, the gateway derives the token key from `AI302_KEY`; a later 302
key rotation would then invalidate outstanding 3D tasks, so the separate secret
is recommended in production.

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
`{ "providerId": "hunyuan3d|hyper3d", "imageDataUrl": "data:image/...", "prompt": "..." }`
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
their matching `ENABLE_302_*` Railway variable is explicitly set to `true`.

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
