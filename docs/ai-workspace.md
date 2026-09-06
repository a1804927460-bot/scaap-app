# Local AI File Tasks

The chat host recognizes one `messs-work` block in an AI response. This is a bounded local file-task protocol, not an unrestricted terminal or a full Codex-style agent loop.

- The requested bounded file task executes automatically without a second confirmation or a code-preview dialog. This does not grant shell, network or arbitrary local-file access.
- QuickJS runs in a worker with 32 MiB guest memory, a 4-second interrupt deadline and an 8-second parent deadline.
- Only extracted text from the latest user attachments is provided as `uploads`. No host filesystem, shell, credentials or network APIs are exposed to guest code.
- Code returns a bounded JSON file specification. Text/source formats, editable PPTX, simple text-image JPG/PNG/WebP and arbitrary-extension base64 binary files are supported. PPTX and raster images are encoded by host libraries, not by renaming text. Image downloads keep the original bytes; result previews load separately on demand. SVG is displayed only in an inert image context, never inserted as markup.
- Files are stored below the Electron user-data directory in `ai-workspace/<hashed-account>/`. Download IDs survive restart and are scoped to the signed-in account (or local guest).
- Maximum six files per task, 16 MiB per output, 30 slides per PPTX, and 256 MiB stored per account. No automatic deletion of user outputs is performed.
- Existing uploads, provider routing, chat billing and download controls are reused. Execution does not issue extra upstream model calls. Image/video billing is unchanged.
- Progress distinguishes execution and saving. Worker failure does not fabricate a download or claim success.

## Verification

Run `node scripts/test-ai-workspace.cjs` and `npx electron scripts/test-ai-workspace-electron.cjs`.

Production release must also validate worker and QuickJS WASM loading inside the packaged app, and a signed-in provider-to-desktop file task. Those checks are not replaced by local unit tests.

## Authorized Host Tasks

The separate `messs-tool` protocol supports local file reads (up to 1 MiB), HTTP(S) GET (up to 1 MiB, no redirects), and system shell commands (30-second timeout and bounded captured output). These are host operations, not QuickJS sandbox operations. Commands run as the desktop user and can modify or delete files. Tool results are sent to the selected model for the requested conversation; up to eight host-tool steps are permitted per message.

Default mode requires approval of each concrete path, URL or command in a themed dialog. Full access requires an explicit confirmation and is scoped to the renderer, current account and current conversation. It is not persisted. New/conversation navigation resets permission, as do renderer navigation and destruction. Revocation prevents subsequent operations; it does not undo completed commands. Download-to-location still uses the existing save dialog.

Automatic installation of dependencies and recovery of interrupted host-task conversations are not implemented. Extra model turns use the existing provider route and its billing, not a free local substitute.
