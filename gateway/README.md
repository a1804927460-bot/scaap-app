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
