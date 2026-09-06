# Canvas Plugins

## Versions

- RichText: https://github.com/ZhengNan-coder/leafer-x-richText, commit `22fee19638c7f84f0a00d51a10311871621daf7e`. Upstream package declares MIT; its repository currently has no standalone LICENSE file.
- Snap: `leafer-x-snap@1.0.7`, package sources and MIT license in `third-party/package`. Tarball SHA1: `12728515ee9a40c58f0a3ea7638b2a9001e6cf55`.
- WebFont: `leafer-x-webfont@0.2.0`, MIT, pinned by package-lock.
- All Leafer runtime imports resolve to the existing `LeaferUI` global. Do not bundle another engine or install Snap's 1.x peer dependency tree.

## Rebuild

The generated files in `src/vendor` are included in desktop packages. To rebuild on a clean checkout:

```powershell
git clone https://github.com/ZhengNan-coder/leafer-x-richText.git third-party/leafer-x-richtext
git -C third-party/leafer-x-richtext checkout 22fee19638c7f84f0a00d51a10311871621daf7e
node scripts/build-canvas-plugins.cjs
```

## Integration

RichText uses the existing canvas renderer and a single temporary textarea for IME input. Selection styles persist as `styleRanges`. Messs retains ownership of board selection, movement, shortcuts and persistence. The adapter calls pinned upstream pointer and range-import methods; upgrade only with integration tests.

Snap's alignment resolver is driven by Messs drag frames, not by a second Editor. Only spatially nearby candidates in the same partition are considered (maximum 256). Tolerance is 3 screen pixels regardless of zoom, without upstream integer rounding. Multi-selection uses its union bounds and one common delta. Alt temporarily bypasses snapping. At most two theme-colored guides are displayed; release, cancellation and disposal remove them.

## Font Service Boundary

WebFont is downloaded and separately bundled, but remote subsetting is NOT enabled by default. Its public default service receives text and font names. A trusted, explicitly configured service and font allowlist are required before calling `MesssCanvasPluginAdapter.createWebFonts(leafer, { baseUrl, resolveFont })`; the caller must await `ready()` before export and call `destroy()` on canvas disposal. Current CSP must also explicitly permit the chosen service and font source. No CSP relaxation or public-service access is included in this change. Existing local/system fonts remain offline.

## Tests

Local font prewarming keeps at most 64 promises and samples at most 256 characters per request. No self-hosted service is available, so the webfont bundle remains dormant. Paragraph alignment stays paragraph-level during range editing; selection-only updates do not rebuild rich-text layout.

The plugin test also checks italic/underline range isolation, paragraph alignment, and selection-only layout reuse. These are browser integration tests, not an OS-level IME or long-running memory-leak certification.

`scripts/test-canvas-plugins.cjs` checks input, per-range styles, roundtrip, cancellation cleanup, zoom-invariant tolerance and absence of external font requests. Existing frame stability and Leafer scene tests remain required. Live IME candidate placement, cross-platform rendering and a production font service still require validation before release.
