# Midjourney 8.2 restoration — 2026-09-09

## Verified upstream contract
- Legnext official models: https://docs.legnext.ai/getting-started/models
- Parameter matrix: https://docs.legnext.ai/getting-started/image-parameters
- Pricing: https://legnext.ai/#pricing ($1 = 1,000 units; standard 80, native HD 120).
- POST /api/v1/diffusion with server-side x-api-key; poll /api/v1/job/{job_id}.
- Explicit --v 8.2 and --fast, --hd only for 2K. No 8.1 fallback.
- Existing entry image-18 restored, version 8.1 stays hidden for historical recovery.
- UI retains the full four-image grid as one generated file; quantity means grids.
- Text-to-image only. Reference upload, advanced follow-up editing and individual grid extraction are not exposed by this entry.
- Application selections override legacy version/HD/ratio/quality flags. Unknown controls, draft and repeat/permutation are rejected to preserve one-task pricing.

## Pricing and validation
Standard $0.08 / HD $0.12; FX 7.3, operations CNY 0.013 per grid, 10% cost buffer, 8.1% estimated payment costs and target 16.9% margin. Rounded quotes: 13 / 19 points per grid at 1,000 points = CNY 70. These estimates cannot guarantee profit under future upstream/fee/FX changes.

A real authenticated 8.2 HD task completed and consumed exactly 120 units. Full grid downloaded and validated as 4096x4096, with four separate image URLs also returned. No additional generation required for recovery verification.

Gateway suite, dedicated version/pricing/invalid-parameter/recovery/ambiguous-submission tests, shared media adapter tests, catalog migration tests, pricing tests, local PostgreSQL pricing execution and actual browser composer checks passed. UI checked at 480/1200 widths in both themes, including restored presets.

## Release state
Local implementation only; no Railway deployment, production database migration or desktop release performed in this task. Apply pending economy migration 202609090001 and then 202609090003 before exposing the new lower HD quote. The intervening Kling migration is part of the pending combined release. Existing reservations and historical ledger charges are not repriced.
