# Messs v0.0.117

- Fix Seedance 2.5 reference generation being interpreted as video editing.
- Fix video completion and failed-task credit release with fractional balances.
- Meter both Agents using verified usage and retain decimal credit balances.
- Allow conversation switching while an Agent works, preserving reply ownership,
  drafts, attachments and streaming output. Keep queue drag reorder without arrows.
- Improve bounded image/video preview decoding and add a 3072px detail tier.
- Check for updates on startup and every 15 minutes, notify main and detached
  canvas windows; installing still requires an explicit restart.

## Verification

Full desktop/gateway `npm test` passed. Separate browser/Electron regressions
passed for conversation switching, queue editing/reordering, both SSE views,
canvas image/video detail pixels, original-resolution zoom and updater broadcasts.
Database rollback tests passed for chat and video fractional settlement.

Production Seedance reference test submitted in 5.1s, delivered a 621241-byte
MP4 in 322s, charged 92 credits on a disposable account, and rejected duplicate
execution/charging. The audit user was deleted after completion. The previously
stuck rejected task released its 370-credit hold without charging.

Official reference: https://www.atlascloud.ai/models/bytedance/seedance-2.5/reference-to-video
The documented explicit `reference` mode avoids asynchronous auto/edit failures.

Live Agent SSE billing passed all three presets; upstream first-token latency
remains variable (36.9s, 4.3s, 6.0s in the audit). No guarantee of zero upstream
failures or uniformly low latency is made.
