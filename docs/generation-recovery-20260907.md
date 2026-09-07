# Generation recovery, 2026-09-07

## Verified findings

- Production had no Plus mixing or FAL Nano overflow switches enabled during
  the reported failures. It was not evidence of a mixed-route regression.
- AI Reiter model discovery succeeded using the configured key. Flash returned
  HTTP 429, "All available accounts exhausted". Pro and Sol returned valid text.
- Paid adapter smoke tests downloaded Nano Pro Max, Nano 2 Max and GPT Image 2
  results, both Nano Plus results, FAL Nano Pro and a four-second MiniMax H3 MP4.
  The Nano/FAL image samples were 1024 square. These small tests are not a load
  test, exhaustive quality comparison or authenticated desktop delivery test.
- The first local smoke invocation omitted the moderation credential and thus
  its moderation check failed. Its separate provider image checks passed; do not
  describe that invocation as an end-to-end production success.
- A failed background-removal reservation had an ai_usage record but no old
  ai_tool_jobs row. The old tool settlement RPC returned not-found. Its one-point
  hold was released through the recovery-aware settlement RPC; no debit occurred.

## Changes

- Automatic Agent strategies can promote to a configured stronger model after
  explicit pre-accept rejection. Manual selections remain fixed. Ambiguous
  responses and accepted tasks do not fall through to another paid submission.
- A missing legacy tool row now triggers an owner-filtered ai_usage lookup and
  a tool allowlist check before invoking shared settlement. Status conflicts and
  recovery holds retain their existing behavior.
- Production configuration requested: AIREITER_IMAGE_PLUS_PERCENT=30 and
  FAL_NANO_BACKUP_ENABLED=true, with a private stable routing secret.
  FAL covers Nano Pro only and runs after proven pre-accept rejection. No unmeasured
  active-request threshold is set. Video routes are not mixed. Existing admission
  queues, tenant isolation and duplicate-charge protections are preserved.
- Local canvas settings fit inside the composer, above it instead of overlapping
  its close button. Narrow composer controls wrap without overlapping text.

## Remaining boundaries

SSE, generated interactive components and formal token-based Agent billing are
not part of this outage hotfix. No new pricing or database schema is deployed by
it. Agent billing remains at the previous setting. No promise of unlimited
provider capacity or zero upstream failures is made.

Rollback: set AIREITER_IMAGE_PLUS_PERCENT=0 and FAL_NANO_BACKUP_ENABLED=false.
Keep both credentials and the routing secret for accepted-task recovery.
