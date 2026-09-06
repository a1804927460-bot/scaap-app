# Messs Agent Parity

Messs main chat and canvas Agent are two views of one product capability, not independent agents.

- For shared changes, inspect both `src/js/ai-assistant.js` and `src/js/canvas-workspace.js`, including detached canvas windows.
- Reuse the common chat backend, model presets, message renderer, artifact handling, permission implementation and pricing calculation. Do not introduce parallel pricing formulas or tool protocols per view.
- Preserve legitimate view differences: canvas context, selection references, layout and conversation history. Do not merge histories or broaden session permissions implicitly.
- Test both entry points for new messages AND restored history. Cover generated-file downloads, errors and completion states when changing response handling.
- A feature is not complete merely because it works in main chat. Report any remaining parity gap explicitly.
- Paid chat is not enabled yet. Verified upstream channel rates and authoritative database reservation/settlement remain required; never label a guessed price as actual billing.
