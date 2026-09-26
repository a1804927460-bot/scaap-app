'use strict';

const MARKET_CONTENT_CACHE_KEY = 'messs.remote-content.market.v1';
const MARKET_FALLBACK_ITEMS = [
  { id: 'phasex', type: 'software', title: 'PHASE X 舞美工作台', description: '舞美项目、屏幕画面、时间段与会议记录管理。Windows 64 位便携版，所有人免费下载，无需积分。', version: '1.0.0 · Windows x64 · 99.4 MB', tone: 'phasex', featured: 100, image: 'assets/phasex-wordmark.png', downloadUrl: 'https://github.com/a1804927460-bot/messs-releases/releases/download/phasex-v1.0.0/PHASE-X-1.0.0-Windows-x64.exe' },
  { id: 'workflow-kit', type: 'plugin', title: 'Workflow Kit', description: 'Batch naming, export queues and reusable production actions.', version: 'v1.0', tone: 'blue', featured: 9 },
  { id: 'canvas-notes', type: 'plugin', title: 'Canvas Notes', description: 'Structured notes and review markers that stay attached to canvas items.', version: 'v1.0', tone: 'green', featured: 8 },
  { id: 'film-color', type: 'preset', title: 'Film Color', description: 'A restrained collection of cinematic color treatments for still images.', version: '24 looks', tone: 'amber', featured: 10 },
  { id: 'clean-product', type: 'preset', title: 'Clean Product', description: 'Neutral product-lighting recipes for consistent catalog imagery.', version: '18 looks', tone: 'red', featured: 7 },
  { id: 'storyboard', type: 'template', title: 'Storyboard System', description: 'Shot planning, references and delivery frames in one reusable canvas.', version: '12 layouts', tone: 'violet', featured: 9 },
  { id: 'brand-board', type: 'template', title: 'Brand Board', description: 'A practical identity review board for marks, type, color and applications.', version: '8 layouts', tone: 'cyan', featured: 8 },
  { id: 'social-pack', type: 'template', title: 'Social Campaign', description: 'Flexible campaign layouts for square, portrait and landscape outputs.', version: '16 layouts', tone: 'coral', featured: 6 },
  { id: 'asset-audit', type: 'plugin', title: 'Asset Audit', description: 'Find duplicates, missing links and oversized source files before delivery.', version: 'v1.0', tone: 'slate', featured: 7 }
];
let MARKET_ITEMS = MARKET_FALLBACK_ITEMS.slice();

const MarketState = { category: 'all', query: '', sort: 'featured', detailItem: null };

function marketLabel(type) {
  const labels = {
    software: t('Software', '软件'),
    plugin: t('Plugin', '\u63d2\u4ef6'),
    preset: t('Preset', '\u9884\u8bbe'),
    template: t('Template', '\u6a21\u677f')
  };
  return labels[type] || type;
}

function marketIcon(type) {
  if (type === 'plugin') return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3v4M16 3v4M6 7h12v5a6 6 0 0 1-12 0z"/><path d="M12 18v3"/></svg>';
  if (type === 'preset') return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>';
  return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg>';
}

function normalizeMarketItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  if (!id || !title) return null;
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  const allowedTypes = ['software', 'plugin', 'preset', 'template'];
  const type = allowedTypes.includes(raw.category)
    ? raw.category : (allowedTypes.includes(metadata.type) ? metadata.type : 'template');
  return {
    id: id.slice(0, 120), type, title: title.slice(0, 120),
    description: String(raw.description || '').trim().slice(0, 600),
    version: String(metadata.version || '').trim().slice(0, 100),
    tone: String(metadata.tone || 'slate').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'slate',
    featured: Number(metadata.featured) || 0,
    image: String(raw.imageUrl || '').trim(),
    downloadUrl: String(raw.actionUrl || '').trim(),
    author: String(metadata.author || 'Messs Studio').trim().slice(0, 80) || 'Messs Studio'
  };
}

function mergeMarketItems(remoteItems) {
  const merged = new Map(MARKET_FALLBACK_ITEMS.map((item) => [item.id, item]));
  (Array.isArray(remoteItems) ? remoteItems : []).map(normalizeMarketItem).filter(Boolean).forEach((item) => merged.set(item.id, item));
  MARKET_ITEMS = [...merged.values()];
}

async function loadRemoteMarketItems() {
  try {
    mergeMarketItems(JSON.parse(localStorage.getItem(MARKET_CONTENT_CACHE_KEY) || '[]'));
    renderMarket();
  } catch (error) {}
  try {
    const result = await window.messsAPI?.content?.list?.('market');
    if (!result?.ok || !Array.isArray(result.items)) return;
    localStorage.setItem(MARKET_CONTENT_CACHE_KEY, JSON.stringify(result.items));
    mergeMarketItems(result.items);
    renderMarket();
  } catch (error) {}
}

function filteredMarketItems() {
  const query = MarketState.query.toLowerCase();
  const items = MARKET_ITEMS.filter((item) => (
    (MarketState.category === 'all' || item.type === MarketState.category) &&
    (!query || `${item.title} ${item.description} ${item.type}`.toLowerCase().includes(query))
  ));
  if (MarketState.sort === 'name') return items.sort((a, b) => a.title.localeCompare(b.title));
  if (MarketState.sort === 'newest') return items.slice().reverse();
  return items.sort((a, b) => b.featured - a.featured);
}

function renderMarket() {
  const grid = document.getElementById('market-grid');
  if (!grid) return;
  const items = filteredMarketItems();
  grid.innerHTML = '';
  document.getElementById('market-empty').hidden = items.length > 0;
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'market-card';
    card.innerHTML = `
      <button type="button" aria-label="${item.title}">
        <div class="market-card-visual is-${item.tone}"><span>${marketIcon(item.type)}</span><i></i><i></i><i></i></div>
        <div class="market-card-copy">
          <span class="market-card-category">${marketLabel(item.type)}</span>
          <h2></h2>
          <p></p>
          <div><span>Messs Studio</span><strong>${t('Coming soon', '\u5373\u5c06\u4e0a\u67b6')}</strong></div>
        </div>
      </button>`;
    card.querySelector('h2').textContent = item.title;
    card.querySelector('p').textContent = item.description;
    card.querySelector('.market-card-copy > div > span').textContent = item.author || 'Messs Studio';
    if (item.image) renderMarketProductImage(card.querySelector('.market-card-visual'), item);
    if (item.downloadUrl) card.querySelector('.market-card-copy strong').textContent = t('Free download', '免费下载');
    card.querySelector('button').addEventListener('click', () => openMarketDetail(item));
    grid.appendChild(card);
  });
}

function openMarketDetail(item) {
  MarketState.detailItem = item;
  const overlay = document.getElementById('market-detail-overlay');
  const visual = document.getElementById('market-detail-visual');
  visual.className = `market-detail-visual is-${item.tone}`;
  visual.innerHTML = `<span>${marketIcon(item.type)}</span><i></i><i></i><i></i>`;
  if (item.image) renderMarketProductImage(visual, item);
  document.getElementById('market-detail-category').textContent = marketLabel(item.type);
  document.getElementById('market-detail-title').textContent = item.title;
  document.getElementById('market-detail-description').textContent = item.description;
  document.getElementById('market-detail-version').textContent = item.version;
  refreshMarketDownloadAction();
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

function renderMarketProductImage(element, item) {
  const image = document.createElement('img');
  image.src = item.image;
  image.alt = item.title;
  image.loading = 'lazy';
  image.decoding = 'async';
  element.replaceChildren(image);
}

function refreshMarketDownloadAction() {
  const action = document.getElementById('market-detail-action');
  const available = Boolean(MarketState.detailItem?.downloadUrl);
  action.disabled = !available;
  action.textContent = available ? t('Free download', '免费下载') : t('Coming soon', '即将上架');
}

function downloadMarketItem() {
  const url = MarketState.detailItem?.downloadUrl;
  if (!/^https:\/\//i.test(String(url || ''))) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function closeMarketDetail() {
  const overlay = document.getElementById('market-detail-overlay');
  overlay.classList.remove('is-visible');
  setTimeout(() => { overlay.hidden = true; }, 160);
}

function refreshMarketLanguage() {
  const labels = [
    ['software', t('Software', '软件')],
    ['all', t('All', '\u5168\u90e8')],
    ['plugin', t('Plugins', '\u63d2\u4ef6')],
    ['preset', t('Presets', '\u9884\u8bbe')],
    ['template', t('Templates', '\u6a21\u677f')]
  ];
  labels.forEach(([id, label]) => {
    const button = document.querySelector(`[data-market-category="${id}"]`);
    if (button) button.textContent = label;
  });
  const heading = document.querySelector('.market-heading h1');
  if (heading) heading.textContent = t('Software, plugins, presets and templates', '软件、插件、预设和模板');
  const search = document.getElementById('market-search-input');
  if (search) search.placeholder = t('Search market', '\u641c\u7d22\u5e02\u573a');
  refreshMarketDownloadAction();
  document.getElementById('market-empty').textContent = t('No matching items.', '\u6ca1\u6709\u5339\u914d\u7684\u5546\u54c1\u3002');
  renderMarket();
}

function initMarket() {
  const grid = document.getElementById('market-grid');
  if (!grid) return;
  document.getElementById('market-categories').addEventListener('click', (event) => {
    const button = event.target.closest('[data-market-category]');
    if (!button) return;
    MarketState.category = button.dataset.marketCategory;
    document.querySelectorAll('[data-market-category]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    renderMarket();
  });
  document.getElementById('market-search-input').addEventListener('input', (event) => {
    MarketState.query = event.target.value.trim();
    renderMarket();
  });
  document.getElementById('market-sort').addEventListener('change', (event) => {
    MarketState.sort = event.target.value;
    renderMarket();
  });
  document.getElementById('market-detail-close').addEventListener('click', closeMarketDetail);
  document.getElementById('market-detail-action').addEventListener('click', downloadMarketItem);
  document.getElementById('market-detail-overlay').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeMarketDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('market-detail-overlay').hidden) closeMarketDetail();
  });
  document.addEventListener('messs:language-changed', refreshMarketLanguage);
  document.getElementById('section-market')?.addEventListener('messs:surface-opened', () => { void loadRemoteMarketItems(); });
  refreshMarketLanguage();
  void loadRemoteMarketItems();
}

document.addEventListener('DOMContentLoaded', initMarket);
