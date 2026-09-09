# Truthful Agent and canvas billing — 2026-09-09

## Changes
- Agent first-response previews count up to the same 100 supplied history messages, resolved document content and image inputs; long inputs are not capped at 24K for estimation. Auto-routing estimates include configured policy fallback models. Tools and continuations are explicitly outside the first-response estimate. Exact future output tokens, cache hits and internal tool calls remain unknown before execution.
- Successful replies in both main and canvas Agent show only gateway-reported charges. Receipts survive local session normalization and persistence, including main-process durable history. Unknown charges stay unknown; partial replies preserve any available receipt.
- Media previews prefer validated gateway quotes even when the desktop pricing version differs. Fast local fallback retains an approximate marker instead of claiming authoritative pricing.
- Generated/tool files no longer fabricate settled charges from quoted prices. Delivery-pending results retain estimates without a debit receipt.
- Canvas reports expose immutable settled credits and fractional Agent credits, with pending reservations separate. Original quotes are retained; current prices only fill completely unrecorded legacy estimates. Missing cloud settlement fields never become a zero receipt through Number(null).
- Canvas Agent requests carry canvas IDs for server attribution. The new database report reads authenticated-user ledger records directly; it never reprices old tasks or rounds fractional chat credits to integers.
- Chat continuations retain per-response usage; gateway budgeting, final quote and SQL settlement apply long-context/cache rates to each response before rounding the whole request once. Existing cost policy is unchanged by this accuracy fix.

## Validation
- Complete gateway suite passed.
- Real PostgreSQL-compatible execution: 21 verified model/usage combinations agree with shared JS pricing, fractional canvas charges, user isolation, malformed usage rejection and idempotent settlement.
- Browser checks: both Agent surfaces, new and restored replies, partial and unknown receipts; visible canvas summary/rows distinguish settled, pending and unknown. Shared rich-message rendering and continuation tests passed.
- Quote tests: newer/lower gateway prices override stale desktop rates; outages produce approximate fallback; missing/delivery-pending tool receipts never become charged amounts.

## Release status
Not deployed in this task. Pending migrations 202609090004_truthful_canvas_usage and 202609090005_chat_usage_turns must accompany the gateway and desktop release. The chat migration requires the existing pending 202609070002 metered-chat schema. Paid-chat enablement and live historical data cannot be claimed verified by these local tests. Existing upstream rate verification dates remain in lib/chat-rates.js; no new upstream price audit was performed in this task.
