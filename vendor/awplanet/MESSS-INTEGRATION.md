# Messs integration

Upstream: https://github.com/awplanets/awplanet
Pinned commit: 40c01a6984e35b24bad0c1222c6c5970b64f18d2

The user confirmed commercial authorization covering integration, UI modification
and distribution on 2026-10-03. That confirmation is not a license grant to others.
Retain LICENSE.txt, NOTICE.md, COMMERCIAL-LICENSE.md and all third-party notices.

Original src/ and public/ are vendored unchanged. Messs adapters and the build
transform live separately. Run npm ci --ignore-scripts in this folder, followed by
node scripts/build-awplanet.cjs from the Messs root. Phone Pilot requires a server
and is not available in this isolated offline integration. No vendor credentials,
remote AI endpoint or Electron bridge are exposed to the embedded editor.
