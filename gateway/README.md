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

Use `AI_PROVIDERS_JSON` to add providers. It contains only endpoint metadata and
the name of a Railway environment variable, never the secret value itself.

```json
[
  {
    "id": "image-2",
    "kind": "image",
    "name": "Second image provider",
    "endpoint": "https://api.example.com/image",
    "keyEnv": "IMAGE_PROVIDER_2_KEY"
  }
]
```
