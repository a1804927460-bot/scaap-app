# Local AI File Tasks

The chat host recognizes one `messs-work` block in an AI response. This is a bounded local file-task protocol, not an unrestricted terminal or a full Codex-style agent loop.

- The user approves code execution in a native confirmation dialog. Cancel is the default.
- QuickJS runs in a worker with 32 MiB guest memory, a 4-second interrupt deadline and an 8-second parent deadline.
- Only extracted text from the latest user attachments is provided as `uploads`. No host filesystem, shell, credentials or network APIs are exposed to guest code.
- Code returns a bounded JSON file specification. Plain text/source formats and editable binary PPTX are supported. PPTX is created by PptxGenJS, not by renaming text.
- Files are stored below the Electron user-data directory in `ai-workspace/<hashed-account>/`. Download IDs survive restart and are scoped to the signed-in account (or local guest).
- Maximum six files per task, 16 MiB per output, 30 slides per PPTX, and 256 MiB stored per account. No automatic deletion of user outputs is performed.
- Existing uploads, provider routing, chat billing and download controls are reused. Execution does not issue extra upstream model calls. Image/video billing is unchanged.
- Progress distinguishes approval, execution and saving. Worker failure does not fabricate a download or claim success.

## Verification

Run `node scripts/test-ai-workspace.cjs` and `npx electron scripts/test-ai-workspace-electron.cjs`.

Production release must also validate worker and QuickJS WASM loading inside the packaged app, and a signed-in provider-to-desktop file task. Those checks are not replaced by local unit tests. Full shell execution, Python dependencies, arbitrary binary generation, iterative tool calls and automatic recovery of an interrupted conversation are not implemented by this protocol.
