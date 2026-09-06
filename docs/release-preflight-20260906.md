# Release Preflight: 2026-09-06

## Current Rollout Status

The user confirmed `(upstream + operating cost) * 1.10 / 0.75`. Fourteen selected migrations, including the two previously applied video migrations, have now been applied and recorded atomically. Image quote parity assertions passed in the transaction; the older baseline was not replayed or marked applied. Production function definitions were backed up locally before rollout.

Railway deployment `d17373dc-394d-4e93-8101-95f9068c889b` succeeded. Health reports catalog 57 and async video enabled. The complete npm test suite passed after FAL pricing and recovery changes. Real Creem moderation passed; live image route checks are in progress.

FAL now uses USD 0.001 for background removal, or USD 0.20/0.35 for standard/4K resizing, including the documented minimum analysis fee. CNY 0.013 operating allocation and the confirmed protection/margin formula apply. Database independently recomputes the quote. The analysis fee is a documented minimum, not an audited upper bound; do not claim an unconditional profit guarantee.

The sections below retain earlier preflight checkpoints, not current deployment state. Desktop publication is not yet confirmed.

## Verified

- `npm test` passes, including the Electron Leafer 5,000-item check and gateway suite.
- Mock queue test: 2,000 tasks, 100 owners, peak concurrency 8, no queued tasks left; overload retries retain request IDs. This is not live provider throughput.
- AI Reiter documentation lists the configured Nano Banana Max channels and GPT Image 2 official channel.
- Gateway public capabilities now preserve the official GPT Image 2 resolution/ratio matrix.
- Railway has configured AI Reiter, Atlas, FAL and Creem key variables. Values were not printed. Presence does not prove successful paid generation.
- Thirteen selected migrations passed a rollback-only production preflight.

## Production Changes Actually Applied

Only `202609050001` and `202609060002` were applied, together in one transaction. They add private video result storage, update the download RPC and fix storage-path validation. Matching migration history rows were recorded.

Post-apply checks confirmed the column, private bucket and both migration history entries. No account balances or historical debit rows were changed. The previous download function definition is saved locally at `test-artifacts/release/video-download-before.json`.

## Release Blockers

- FAL now uses durable image job claims, provider task records and private result storage in local source. Five mocked recovery/concurrency tests pass. The supporting image migrations and gateway code are not deployed yet; provider acceptance followed by an unavailable database still requires recovery attention.
- FAL tool prices still use legacy tool IDs and rates; verify current upstream prices and align all three billing surfaces.
- Current price formula is `(cost + operations) * 1.10 / 0.75`, not additive `cost * 1.35`. Resolve this mismatch against the requested pricing policy before applying pricing migrations.
- Production lacks image recovery tables and newer media reservation RPCs. Remaining migrations were rolled back, NOT applied.
- Baseline migration history is divergent: two remote timestamped migrations were fetched, while older local migrations have no corresponding history and `202608220002` is duplicated. Do not blindly run `db push --include-all` or mark unknown migrations applied.
- Complete end-to-end generation, settlement, recovery and old-desktop compatibility checks before gateway rollout.
- Earlier requested profile editor UI and shared account footer remain unfinished; backend draft handlers alone are not completion.

No gateway deployment, Git push, desktop tag or installer release was performed in this preflight.

## Continuation

GitHub authentication through the Git credential helper was verified without printing tokens. The latest public installer is still v0.0.107. Local package version is v0.0.108.

FAL public pages were checked: Feynobg is USD 0.001/generation; smart-resize is USD 0.15/output (double for 4K) plus a minimum USD 0.05 analysis fee. Legacy USD 0.50 fixed tool prices are not those documented prices and have not been changed or deployed yet.

The pricing policy question (additive 35% versus 25% gross margin after protection) has been presented to the user. Do not represent this continuation as a published update.
