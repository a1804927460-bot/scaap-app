'use strict';
// Pinned leafer-x-snap 1.0.7 bridge: Messs owns dragging, indexing and overlays.
// The plugin only resolves candidate alignment; it never installs editor events.
window.MesssCanvasPluginAdapter = {
  warmLocalFont(note) {
    if (!document.fonts) return Promise.resolve();
    const family = !note.fontFamily || note.fontFamily === 'inherit' ? 'Segoe UI, PingFang SC, Microsoft YaHei, Arial, sans-serif' : note.fontFamily;
    const spec = `${note.fontWeight || 400} ${Math.max(10, Math.min(160, Number(note.fontSize) || 32))}px ${family}`;
    const sample = String(note.text || 'Aa').slice(0, 256);
    const key = `${spec}\n${sample}`;
    const cache = this._localFonts || (this._localFonts = new Map());
    if (cache.has(key)) return cache.get(key);
    const ready = document.fonts.load(spec, sample).catch(() => []);
    cache.set(key, ready);
    while (cache.size > 64) cache.delete(cache.keys().next().value);
    return ready;
  },
  async createWebFonts(leafer, config) {
    if (!config?.baseUrl || typeof config.resolveFont !== 'function') return null;
    if (!this._fontScript) this._fontScript = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'vendor/canvas-webfont.js';
      script.onload = resolve; script.onerror = () => { this._fontScript = null; script.remove(); reject(new Error('Font plugin unavailable')); };
      document.head.append(script);
    });
    await this._fontScript;
    return new MesssWebFont.WebFontPlugin(leafer, { ...config, debounceMs: 180 });
  },
  beginText(note, content, node) {
    if (!node || node.tag !== 'RichText') return false;
    const controller = new AbortController();
    const session = { note, node, content, controller, original: node.toJSON() };
    session.base = { fontFamily: note.fontFamily, fontSize: note.fontSize, fontWeight: note.fontWeight, color: note.color, colorMode: note.colorMode, align: note.align };
    session.originalBase = { ...session.base };
    this._text = session;
    content.closest('.board-text-note').classList.add('is-richtext-editing');
    document.getElementById('text-tool-panel').setAttribute('data-rt-panel', 'true');
    node.onEditingExited = () => { if (this._text === session) commitActiveTextNote(); };
    node.enterEditing();
    void this.warmLocalFont(note).then(() => { if (this._text === session) node.forceRender(); });
    const textarea = document.querySelector('[data-richtext-editor]');
    const bounds = content.getBoundingClientRect();
    if (textarea) {
      textarea.style.left = `${Math.max(0, bounds.left)}px`;
      textarea.style.top = `${Math.max(0, bounds.top)}px`;
      textarea.addEventListener('input', () => {
        note.text = node.text; content.textContent = node.text;
        const element = content.closest('.board-text-note');
        if (element) scheduleBoardItemMeasurement(note.id, element, note);
      }, { signal: controller.signal });
      textarea.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault(); event.stopImmediatePropagation();
          finishTextNoteEditing({ cancel: event.key === 'Escape' });
        }
      }, { capture: true, signal: controller.signal });
    }
    let selecting = false;
    const point = event => { const r = document.getElementById('board-viewport').getBoundingClientRect(); return { x: event.clientX-r.left, y: event.clientY-r.top, shiftKey: event.shiftKey }; };
    content.addEventListener('mousedown', event => {
      selecting = true; event.preventDefault(); event.stopPropagation(); node._handlePointerDown(point(event)); node.refocus();
    }, { signal: controller.signal });
    document.addEventListener('mousemove', event => { if (selecting) node._handlePointerMove(point(event)); }, { signal: controller.signal });
    document.addEventListener('mouseup', event => { if (selecting) node._handlePointerUp(point(event)); selecting = false; }, { signal: controller.signal });
    session.style = this.textStyle(note);
    return true;
  },
  textStyle(note) {
    return { fontFamily: !note.fontFamily || note.fontFamily === 'inherit' ? 'Segoe UI, PingFang SC, Microsoft YaHei, Arial, sans-serif' : note.fontFamily,
      fontSize: note.fontSize, fontWeight: note.fontWeight, fill: textNoteDisplayColor(note), textAlign: note.align || 'left' };
  },
  applyTextStyle(note) {
    const session = this._text; if (!session || session.note !== note) return;
    const next = this.textStyle(note), diff = {};
    for (const key of Object.keys(next)) if (next[key] !== session.style[key]) diff[key] = next[key];
    if (!Object.keys(diff).length) return;
    // Alignment belongs to the paragraph, even when characters are selected.
    if ('textAlign' in diff) {
      session.node.textAlign = diff.textAlign;
      session.base.align = note.align;
      delete diff.textAlign;
    }
    if (session.node.selectionStart !== session.node.selectionEnd) {
      session.node.setSelectionStyles(diff);
      Object.assign(note, session.base);
    } else {
      session.node.setFullTextStyles(diff); Object.assign(session.node, diff);
      for (const key of Object.keys(session.base)) session.base[key] = note[key];
    }
    session.style = this.textStyle(note);
    note.styleRanges = session.node.toJSON().styleRanges || [];
    session.node.refocus();
    void this.warmLocalFont(note).then(() => { if (this._text === session) session.node.forceRender(); });
  },
  finishText(cancel) {
    const session = this._text; if (!session) return false;
    this._text = null;
    const { node, note, content, controller, original } = session;
    node._messsTextLayoutKey = null;
    node.onEditingExited = null;
    const data = cancel ? original : node.toJSON();
    note.text = data.text || ''; note.styleRanges = data.styleRanges || [];
    if (cancel) Object.assign(note, session.originalBase);
    node.exitEditing(); controller.abort();
    content.closest('.board-text-note')?.classList.remove('is-richtext-editing');
    content.textContent = note.text;
    return true;
  },
  snap(bounds, candidates, zoom) {
    const snap = this._snap || (this._snap = new MesssCanvasPlugins.Snap({
      isApp: true, tree: {}, editor: { multiple: false }, zoomLayer: { scaleX: 1 }
    }, { snapSize: 3, showLinePoints: false }));
    const points = b => ({ tl: { x: b.x, y: b.y }, tr: { x: b.x + b.w, y: b.y },
      bl: { x: b.x, y: b.y + b.h }, br: { x: b.x + b.w, y: b.y + b.h }, c: { x: b.x + b.w / 2, y: b.y + b.h / 2 } });
    const lines = [];
    snap.clearLines = () => {};
    snap.drawLines = (segments, axis) => {
      if (!segments.length) return;
      const coordinate = axis === 'x' ? segments[0][1] : segments[0][0];
      const ends = segments.flatMap(line => axis === 'x' ? [line[0], line[2]] : [line[1], line[3]]);
      lines.push(axis === 'x' ? [Math.min(...ends), coordinate, Math.max(...ends), coordinate] : [coordinate, Math.min(...ends), coordinate, Math.max(...ends)]);
    };
    // Avoid the plugin's integer rounding expanding the tolerance at high zoom.
    snap.isInRange = (a, b) => Math.abs(a - b) * zoom <= 3;
    snap.getSnapPoints = points;
    snap.snapPoints = candidates.map(points);
    const target = { ...bounds };
    snap.handleMove({ target });
    snap.snapPoints = [];
    return { dx: target.x - bounds.x, dy: target.y - bounds.y, lines };
  },
  clearGuides() {
    this._guides?.remove(); this._guides = null;
  },
  showGuides(lines, view, viewport) {
    if (!lines.length) { this.clearGuides(); return; }
    if (!this._guides) {
      this._guides = document.createElement('div');
      this._guides.className = 'board-snap-guides';
      this._guides.setAttribute('aria-hidden', 'true');
      viewport.append(this._guides);
    }
    while (this._guides.children.length < lines.length) this._guides.append(document.createElement('i'));
    [...this._guides.children].forEach((el, i) => {
      el.hidden = !lines[i]; if (!lines[i]) return;
      const [x1, y1, x2, y2] = lines[i];
      el.style.cssText = `left:${x1 * view.zoom + view.panX}px;top:${y1 * view.zoom + view.panY}px;width:${Math.max(1, (x2-x1)*view.zoom)}px;height:${Math.max(1,(y2-y1)*view.zoom)}px`;
    });
  }
};

for (const [id, property, enabled, disabled] of [['text-italic', 'italic', true, false], ['text-underline', 'textDecoration', 'under', 'none']]) {
  const button = document.getElementById(id);
  button?.addEventListener('mousedown', event => event.preventDefault());
  button?.addEventListener('click', () => {
    const session = MesssCanvasPluginAdapter._text; if (!session) return;
    const { node, note } = session;
    const value = node.getStyleAt(node.selectionStart)[property] === enabled ? disabled : enabled;
    const style = { [property]: value };
    if (node.selectionStart !== node.selectionEnd) node.setSelectionStyles(style);
    else node.setFullTextStyles(style);
    note.styleRanges = node.toJSON().styleRanges || [];
    button.classList.toggle('is-active', value === enabled);
    node.refocus();
  });
}
