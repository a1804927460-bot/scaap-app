# Metered Agent Chat

Both desktop Agents call the same `/v1/chat` gateway. The gateway now reserves
credits before each upstream call (including automatic continuations), then
settles actual reported input, output and cached-input tokens. Routing metadata
is server-owned, so automatic failover charges the model actually used.

## Prices

Verified from https://aireiter.com/market on 2026-09-07. The embedded SKU table
uses USD cents per million tokens. Public product pages corroborate the units.
FX follows the existing 7.3 CNY/USD accounting rate; 1000 credits = CNY 70.
Chat adds 20% cost protection, rounding up to 0.01 credit per gateway operation
(all automatic output continuations in that operation are summed first).
MCP follow-up calls are separate billed operations.

| Model | USD input/M | USD output/M | USD cached input/M |
| --- | ---: | ---: | ---: |
| Gemini 3.8 Flash | 0.225 | 1.125 | 0.0225 |
| Gemini 3.1 Pro | 0.60 | 3.60 | 0.06 |
| GPT-5.6 Sol | 1.20 | 6.00 | 0.12 |
| Kimi K3 | 1.50 | 7.50 | 0.15 |

The market displays rounded Flash output pricing (1.13); the precise SKU value
is 112.5 cents (1.125 USD), which is used for settlement. Other suppliers/models
require verified rates before use; matching a model name is insufficient.
Cache creation is not enabled without a verified supported usage contract.

## Guarantees And Limits

- Database row locks serialize account mutations across chat/image/video.
- Per-operation claims prevent concurrent duplicate upstream submissions.
- RPC retries retain the claim and settlement is idempotent.
- Missing/malformed usage fails closed; no invented token charges.
- Failed chat operations release their holds. Earlier successful MCP calls
  remain billed if a later task step fails. Interrupted upstream cost without
  usable accounting is borne by the operator, not estimated as a user debit.
- Upstream token limits are bounded; conservative per-call holds include
  context/system overhead. If an upstream violates that bound, any charge
  above the hold is borne by the operator and preserved in the private receipt.
- Crash-abandoned holds expire on subsequent reservations after 30 minutes.
- Rates, usage and actual provider/model are in service-only `ai_chat_billing`.
  Customers receive charges and account balances, not internal routing/prices.
- Decimal account/ledger/usage fields preserve prior integral media prices.
  The attribution view retains service-only access. The deployed authoritative
  reporting function retains request counts while removing credit truncation.
- User-supplied direct-provider credentials keep their existing BYOK behavior;
  production Messs gateway traffic is metered regardless of client version.

## Verification

`npm test` and `node scripts/test-ai-workspace-ipc.cjs` passed locally.
`node scripts/test-chat-billing-db.cjs --linked` tested the migration plus
account/ledger/summary behavior in a transaction rolled back in its entirety.
The targeted migration was applied, and `--linked --existing` passed again.
No existing customer balance was changed by these tests.

`scripts/probe-live-chat-routes.mjs` requires explicit live audit configuration,
creates a disposable account, funds only that account, tests zero-balance denial,
concurrent reservations, real usage charging and duplicate rejection, verifies
the resulting ledger, and deletes the temporary user in `finally`.
