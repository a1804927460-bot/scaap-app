# Canvas Image Crop

- Butler > Crop image opens an on-canvas editor, with free/original/common aspect ratios, reset, cancel and apply.
- Uses `leafer-x-clip-resize-inner-editor@1.10.0` (MIT). Build with `npm run build:canvas-crop`.
- The runtime loads on demand and is isolated from the main canvas plugin registry. The build resolves one ESM draw implementation from Leafer 2.2.9; mixing 2.2.10 draw or CommonJS creates incompatible render objects.
- A temporary App exists only during editing. Cancel/Escape/window resizing destroys it and its listeners. No AI, gateway or credit charge is involved.
- Apply exports a PNG at source resolution, imports through `images:importCrop` without reading the OS clipboard, and places a new file next to the original. The original is never overwritten.
- Source and output are limited to 40 MP. Browser decoding/export still needs memory proportional to the original image size. No claim of unlimited-size support.
- `scripts/test-canvas-crop.cjs` exercises the real plugin, pointer drag, ratio, exact output dimensions and color pixels, cancellation and responsive light/dark views. Its persistence IPC is mocked; desktop persistence requires an Electron smoke test.
