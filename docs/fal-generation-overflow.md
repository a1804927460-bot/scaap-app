# FAL Generation Overflow

Status: local implementation, disabled by default, not deployed or live-load verified.

## Supported Contract

Only `image-1` Nano Banana Pro is mapped, to `fal-ai/nano-banana-pro`
or `/edit` when references exist. AI Reiter endpoints and public product IDs
are unchanged. FAL routes are hidden. Videos and other image models are unchanged.
Unsupported aspect ratios, output counts, or resolutions stay on the primary.
This is capability compatibility, not an assertion of pixel-identical quality.

Verified schema sources on 2026-09-07:
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-pro
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-pro/edit

## Configuration

`FAL_API_KEY` (or `FAL_KEY`) is server-only.
`FAL_NANO_BACKUP_ENABLED=true` enables pre-accept rejection fallback.
`AIREITER_NANO_OVERFLOW_AT` optionally sets an integer 1-128 for active primary
requests per gateway process; unset means rejection fallback only.
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

FAL is a capacity fallback, not necessarily cheaper. Live cost reconciliation,
successful canvas delivery after reconnect, restart recovery, and quota/load
tests must be performed in staging before enabling production overflow.
Do not promise zero upstream failures or unlimited capacity.

## Remaining Rollout Work

- Verify real account credentials/quotas and paid reference-image generation.
- Verify task persistence, object storage and frontend reconnect end to end.
- Add distributed upstream admission if running multiple gateway replicas.
- Map each video model only after matching version, duration, resolution,
  reference inputs, audio and asynchronous recovery contracts; none enabled here.
- Add internal per-provider cost/latency/error monitoring before broad rollout.

Tests: `node scripts/test-fal-generation.mjs`, `node scripts/test-gateway-providers.mjs`.
