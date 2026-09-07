# Release 0.0.115

## Backend prerequisites

- Gateway 21d7fe0 deployed successfully before desktop release preparation.
- Compatible image channel mixing is enabled; video provider routes and customer image prices are unchanged.
- Large base64 media validation no longer overflows the regular-expression stack.
- Accepted overdue video jobs query upstream before deciding their state and retain recoverable download/storage failures without resubmitting generation.
- Applied migration 202609070001 to production with its history record in one transaction. Video worker claim RPC execution is restricted to service_role.
- Read-only release-db-preflight.sql passed: 15 reviewed migrations, job/usage RLS, service RPC permissions, private media buckets, and 15 image quotes matching client pricing.
- Historical failed tasks and customer balances were not modified. Divergent legacy migration history was not blindly replayed or repaired.

## Desktop

- Shared first-reply credit estimates for both Agent interfaces, including late-response and IPC-failure handling.
- Long-press canvas/folder ordering, direct unpin interaction, bounded generation settings and image previews.
- Localized provider errors retaining request identifiers, and bundled reduced-motion-aware menu transitions.
- Agent estimates are not a whole-task spending cap and exclude media/tool costs. Formal token billing, full SSE and generative UI are not claimed as delivered by this release.

## Verification before publication

- Full npm test passed on version 0.0.115, including gateway regressions and video worker permission checks.
- Playwright assistant preview, moodboard generation, composer actions, library reorder and library interaction suites passed.
- Representative narrow-screen dark-theme parameter popover screenshot inspected.
- Previous gateway audit exercised six real FAL image generation/edit combinations and a 7 MB background-removal input. These are adapter checks, not complete authenticated desktop end-to-end tests.
- Publish desktop tag only after the release commit's Railway deployment and health check succeed. Verify Windows and both macOS architecture artifacts and update manifests after CI publication.
- Builds follow the existing release signing configuration; no new signing/notarization credentials were introduced.
