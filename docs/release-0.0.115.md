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

## Publication results

- Release commit/tag: b771d10d7ab31899d8e339d0e99b06a315bbc2ae / v0.0.115.
- Railway deployment 0b7b95da-9245-4845-a27c-11ee71b39767 succeeded before the desktop tag was pushed. Health returned ok=true, catalogVersion=57, asyncVideo=true.
- GitHub Actions run 34079411152 succeeded: Windows 16m08s, macOS 2m53s.
- Public release: https://github.com/a1804927460-bot/messs-releases/releases/tag/v0.0.115
- All eight assets returned HTTP 200 with the declared sizes. Both updater manifests declare 0.0.115 and reference the correct Windows/Intel/Apple Silicon artifacts.
- Windows installer downloaded completely: 402403964 bytes, SHA-512 matched latest.yml.
- Electron updater using the same GitHub provider as the desktop app detected 0.0.115 successfully. Fixed the standalone probe to use the updater's own SemVer constructor rather than a different dependency instance.
- macOS artifacts were built/tested in macOS CI and their public availability/manifests checked; no local macOS installation or desktop smoke test was performed.
- CI reports deprecated Node 20 action runtimes for checkout/setup-node v4; builds succeeded using the runner's forced Node 24 action runtime. Application build commands use Node 22.
