# FAL Generation Overflow

All three public image models are implemented. Flags default off in code;
production rollout settings and verification are recorded below. No load-capacity
or zero-failure guarantee is implied.

## Supported Contract

| Public ID | Model | FAL endpoint | References |
| --- | --- | --- | --- |
| image-1 | Nano Banana Pro | fal-ai/nano-banana-pro | Up to 8 |
| image-2 | Nano Banana 2 | fal-ai/nano-banana-2 | Up to 8 |
| image-6 | GPT Image 2 | fal-ai/gpt-image-2 | Up to 9 |

All use `/edit` when references exist. AI Reiter endpoints and public product IDs
are unchanged. FAL routes are hidden. Videos and retired image models are unchanged.
Unsupported aspect ratios, output counts, or resolutions stay on the primary.
This is capability compatibility, not an assertion of pixel-identical quality.
GPT low/medium/high are passed explicitly; dimensions use the exact official
AIReiter 1K/2K/4K table, including 2048x1360 for 3:2 at 2K and only the six
officially supported 4K ratios. No approximate resizing or quality downgrade.
AIReiter's cheaper `gpt_image_2` channel omits the quality contract and documents
variable small output dimensions; it is deliberately not mixed with official.

Verified schema sources on 2026-09-07:
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-pro
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-pro/edit
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-2
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-2/edit
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/gpt-image-2
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/gpt-image-2/edit
- https://docs.aireiter.com/en/api-reference/images/gpt-image-2-official/generation.md
- https://docs.aireiter.com/en/api-reference/images/gpt-image-2/generation.md

## Configuration

`FAL_API_KEY` (or `FAL_KEY`) is server-only.
`FAL_NANO_BACKUP_ENABLED=true` enables pre-accept rejection fallback.
This legacy flag enables only Nano Pro. `FAL_IMAGE_BACKUP_ENABLED=true` enables
all three models. The requested rollout configuration (pending deployment) is:

```ini
FAL_IMAGE_BACKUP_ENABLED=true
FAL_IMAGE_MIX_PERCENT=10
FAL_GPT_IMAGE_MIX_PERCENT=20
AIREITER_IMAGE_PLUS_PERCENT=60
```

Keep the existing `AIREITER_IMAGE_ROUTING_SECRET` stable across replicas.
FAL percentages accept 0-40; absent/invalid values disable weighted selection,
not rejection fallback. Selection is server-side HMAC over operation ID and
logical provider ID. Expected normal shares are Nano Max 36%, Plus 54%, FAL 10%;
GPT official 80%, FAL 20%. These are statistical shares, not user rate limits.
Health fallback can change observed shares. Missing keys or incompatible requests
leave the original primary usable. No new user admission limit is introduced.
`AIREITER_NANO_OVERFLOW_AT` optionally sets an integer 1-128 for active primary
requests per gateway process; unset disables this concurrency-based preference
(weighted mixing and explicit rejection fallback still operate).
Do not choose this threshold without measuring the upstream account quota and
dividing capacity among gateway replicas. This counter is NOT a distributed
account-wide semaphore. The existing fair admission queue remains in place.

Keep the FAL key during rollback: disabling new routing must not prevent
recovery of accepted FAL task IDs. No new database schema is needed, but the
existing image job, storage and credit reservation migrations are prerequisites.

## Billing And Recovery

The original logical request retains one reservation and customer price.
The task hook persists the actual FAL provider/task ID before polling. Result
storage uses the existing durable image result hook before success settlement.
An accepted task, socket timeout, polling error, download error or storage error
never authorizes a second generation. Recovery polls the original task.
Confirmed terminal failures follow existing reservation release logic. Unknown
outcomes remain pending, not automatically refunded and resubmitted.

FAL is capacity diversification, not necessarily cheaper. Live cost reconciliation,
successful canvas delivery after reconnect, restart recovery, and quota/load
tests must be performed in staging before enabling production overflow.
Do not promise zero upstream failures or unlimited capacity.

## Verification And Limits

- Focused real-account 1K generation and edit checks use
  `node scripts/smoke-generation-backups.mjs --live --mode=mixed [--edit]`.
  They force the deterministic FAL selection bucket through public model IDs,
  record accepted task identities, validate downloaded images, and verify GPT
  output is exactly 1024x1024. They do not test authenticated desktop delivery.
- Verify task persistence, object storage and frontend reconnect end to end.
- Add distributed upstream admission if running multiple gateway replicas.
- Map each video model only after matching version, duration, resolution,
  reference inputs, audio and asynchronous recovery contracts; none enabled here.
- Add internal per-provider cost/latency/error monitoring before broad rollout.

Tests: `npm --prefix gateway run check`, `node scripts/test-all-image-mixing.mjs`,
`node scripts/test-fal-generation.mjs`, `node scripts/test-fal-overflow-routing.mjs`,
`node scripts/test-gateway-providers.mjs`. The all-model test is included in the
gateway suite and covers matrices, stable distribution, both directions of
pre-accept rejection fallback, no replay after ambiguity/acceptance, private
route metadata, missing keys, and rollback recovery without any POST.
