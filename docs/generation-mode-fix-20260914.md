# Generation validation and billing repair — 2026-09-14

Kling validation now runs after legacy parameter normalization. A 1080P request without a service tier infers Pro, and a reference image's explicit ratio normalizes to adaptive. Regression tests execute the actual gateway validation function. This reproduces one pre-submission 400 path; historical logs discarded the original validation code, so it is not proof that every reported 400 had this cause.

The desktop now preserves normal/performance mode in its media options, gateway payload, saved generation metadata and usage history. Desktop and gateway use one pricing function and version. Performance images round the unit price before multiplying by count, matching the application's individual image requests. Normal prices remain unchanged. The existing 1.6 retail factor is retained; this repair does not certify every supplier's current cost or guarantee profitability for all models.

The additive `202609140001_mode_image_reservation.sql` migration recomputes performance image prices server-side and is accessible only to the existing service role. It was applied to production. A read-only check with deliberately incorrect expected credits returned 16 normal / 26 performance for two image-1 2K images. No user balance was modified by that check. A missing new RPC fails closed instead of falling back to normal billing.

Video reservations already preserve a higher server estimate in the existing SQL. Thus a normal DB quote of 79 versus performance estimate 127 alone was not evidence of a video reservation mismatch. Nano image route affordability now uses the selected mode's budget; performance retains candidate priority rather than sorting it back to the cheapest candidate. Unaffordable routes remain excluded and route configuration remains in the administrator's system.

Kling quote network failures are explicitly pre-submission failures. Logs record an allowlisted stage (price check, upload, submission) without prompts, URLs, credentials or raw upstream responses.

Validation: gateway suite 235 tests passed before the additional desktop transport regression; four targeted mode tests then passed. PostgreSQL/PGlite: 96 image mode/size/count combinations match the database; 76 Kling combinations match normal prices. Existing desktop pricing, provider options, media provider and persistence checks passed. Authenticated Atlas checks confirmed all nine five-second silent resolution combinations; no new paid video was submitted.

Deployment: database migration applied and verified. Desktop/gateway source has not been pushed or deployed: Git CLI has no usable GitHub credential. Existing size-panel UI changes and screenshot artifacts are preserved separately in the working tree.
