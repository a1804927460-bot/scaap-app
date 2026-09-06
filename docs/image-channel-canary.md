# Image channel canary

Implemented locally, disabled by default. Only Nano Banana 2 Max -> Plus and
Nano Banana Pro Max -> Plus are eligible, on the existing AI Reiter endpoint.
GPT Image 2 remains official; all video routes are unchanged. No public model
name, quality, reference image, resolution, aspect ratio or retail quote changes.

## Verified sources (2026-09-07)

- https://docs.aireiter.com/en/api-reference/images/nano-banana-v2/generation
- https://docs.aireiter.com/en/api-reference/images/gemini-3-pro/generation
- https://docs.aireiter.com/en/api-reference/images/gpt-image-2-official/generation
- https://aireiter.com/image/nano-banana-v2
- https://aireiter.com/image/nano-banana-pro
- https://aireiter.com/image/gpt-image-2

Nano docs state channels affect stability, not quality. This is an upstream
claim, not a completed Messs visual evaluation. Both Nano API docs permit eight
references and 1K/2K/4K. The Nano2 marketing page says nine references; keep the
API's stricter eight. Base variants have no separately verified market price and
are not eligible. GPT standard lacks equivalence to official quality settings,
so its lower prices do not justify silently substituting it for official.

USD per image, in 1K / 2K / 4K order:

| Model | Max | Plus |
| --- | --- | --- |
| Nano Banana 2 | .077 / .1155 / .154 | .048 / .072 / .108 |
| Nano Banana Pro | .165 / .165 / .33 | .0576 / .0576 / .0708 |

At 30% Plus, raw expected savings are ~9.0-11.3% for Nano2 and ~19.5-23.6%
for Pro, excluding failures, retries and operational cost. This change does not
pretend that the original Max cost is the actual internal cost of a Plus request.
Per-channel financial reconciliation remains a rollout prerequisite.

## Rollout

After controlled comparisons and internal cost/latency reconciliation, set only
on the gateway:

```ini
AIREITER_IMAGE_PLUS_PERCENT=30
AIREITER_IMAGE_ROUTING_SECRET=<independent random secret, at least 32 characters>
```

Keep the secret fixed across replicas. Zero or unset disables; values outside
0-40 fail closed. The HMAC of operation ID chooses a stable statistical bucket;
30% is an expected share, not a hard per-user or small-batch quota. Do not expose
these settings to the desktop/public provider catalog.

Three consecutive observed failures within five minutes pause that Plus channel
for ten minutes in the current process. This is not a distributed health service.
Accepted-task recovery queries the persisted task ID without resubmitting.
Only a proven pre-accept failure can retry on Max. Ambiguous POST outcomes, task
IDs and post-accept failures must never trigger a second paid generation.

Before enabling: compare fixed prompt suites at each resolution with text,
portraits, references and editing; measure success, p95 time and visual regressions.
Retain actual channel/cost receipts in internal observability before production
rollout. The UI need not expose infrastructure, but product quality/official
claims must remain accurate. No production setting was changed by this patch.
