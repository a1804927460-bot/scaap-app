'use strict';

const MESSS_TEMPLATE_CACHE_KEY = 'messs.remote-content.templates.v1';
const MESSS_TEMPLATE_RECENT_KEY = 'messs.template-recents.v1';
const MESSS_TEMPLATE_CATEGORIES = {
  all: ['All categories', '全部分类'],
  'music-cover': ['Music covers', '音乐封面'],
  'stage-visual': ['Stage visuals', '舞美视觉'],
  'brand-visual': ['Brand visuals', '品牌视觉'],
  'product-ad': ['Product advertising', '产品广告'],
  storyboard: ['Storyboards', '分镜故事']
};
const MESSS_TEMPLATE_FALLBACKS = [
  { id: 'music-neon-pulse', category: 'music-cover', title: '霓虹律动专辑封面', description: '高对比舞曲封面与中心人物构图', kind: 'image', tone: 'magenta', prompt: '音乐专辑封面，中心人物肖像，黑色背景，克制的霓虹灯带与金属质感，高对比棚拍光线，清晰标题留白，方形构图，精致商业视觉' },
  { id: 'music-minimal-vinyl', category: 'music-cover', title: '黑胶极简封面', description: '留白、黑胶与编辑排版', kind: 'image', tone: 'ivory', prompt: '极简音乐专辑封面，黑胶唱片与抽象纸张构成，大面积留白，黑白编辑排版，柔和侧光，细腻纸张纹理，现代平面设计，方形构图' },
  { id: 'stage-red-architecture', category: 'stage-visual', title: '红色建筑舞台', description: '大型屏幕与纵深灯阵', kind: 'image', tone: 'red', prompt: '大型演唱会舞美视觉，红色几何建筑结构，多层LED屏幕，纵深灯阵与薄雾，中心对称构图，真实舞台工程尺度，电影级光影，超宽画幅' },
  { id: 'stage-silver-wave', category: 'stage-visual', title: '银色流体舞美', description: '金属流体与冷白追光', kind: 'video', tone: 'silver', prompt: '舞台主屏动态视觉，银色液态金属缓慢流动，冷白追光穿过薄雾，镜面反射，节奏平稳，循环首尾衔接，克制高级，无文字，超宽画幅' },
  { id: 'brand-monochrome-system', category: 'brand-visual', title: '黑白品牌系统', description: '标志、字体和应用场景', kind: 'image', tone: 'graphite', prompt: '高端品牌视觉系统展示，黑白标志、字体规范、名片与包装应用，模块化网格排版，真实纸张与压印细节，俯拍，整洁专业' },
  { id: 'product-glass-studio', category: 'product-ad', title: '玻璃质感产品广告', description: '透明材质与柔和棚拍光', kind: 'image', tone: 'cyan', prompt: '高端产品广告摄影，透明玻璃材质产品置于简洁展台，柔和棚拍光线，清晰轮廓与折射，高级商业构图，背景干净，留出文案空间' },
  { id: 'storyboard-night-drive', category: 'storyboard', title: '夜间驾驶分镜', description: '电影感六格镜头序列', kind: 'image', tone: 'blue', prompt: '电影分镜板，夜间城市驾驶场景，六个连续镜头，包含远景、中景、特写和车内视角，统一角色与车辆，雨夜反光，清晰镜头节奏，专业分镜排版' }
];

const MesssTemplateState = { items: MESSS_TEMPLATE_FALLBACKS.slice(), query: '', category: 'all', view: 'all', onSelect: null };

function messsTemplateText(en, zh) {
  return typeof t === 'function' ? t(en, zh) : zh;
}

function messsTemplateNormalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  if (!id || !title) return null;
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  return {
    id: id.slice(0, 120),
    category: String(raw.category || 'other').trim().slice(0, 60) || 'other',
    title: title.slice(0, 120),
    description: String(raw.description || '').trim().slice(0, 600),
    prompt: String(raw.prompt || '').trim().slice(0, 12000),
    kind: raw.kind === 'video' ? 'video' : 'image',
    imageUrl: String(raw.imageUrl || '').trim(),
    tone: String(metadata.tone || raw.tone || 'graphite').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'graphite',
    categoryLabelZh: String(metadata.categoryLabelZh || '').trim().slice(0, 40),
    categoryLabelEn: String(metadata.categoryLabelEn || '').trim().slice(0, 60),
    sortOrder: Number(raw.sortOrder) || 0
  };
}

function messsTemplateReadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
  catch (error) { return fallback; }
}

function messsTemplateMerge(remote) {
  const merged = new Map(MESSS_TEMPLATE_FALLBACKS.map((item) => [item.id, item]));
  (Array.isArray(remote) ? remote : []).map(messsTemplateNormalize).filter(Boolean).forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
}

async function loadMesssTemplates() {
  const cached = messsTemplateReadJson(MESSS_TEMPLATE_CACHE_KEY, []);
  MesssTemplateState.items = messsTemplateMerge(cached);
  renderMesssTemplateLibrary();
  try {
    const result = await window.messsAPI?.content?.list?.('templates');
    if (!result?.ok || !Array.isArray(result.items)) return;
    localStorage.setItem(MESSS_TEMPLATE_CACHE_KEY, JSON.stringify(result.items));
    MesssTemplateState.items = messsTemplateMerge(result.items);
    renderMesssTemplateLibrary();
  } catch (error) {}
}

function messsTemplateRecentIds() {
  const value = messsTemplateReadJson(MESSS_TEMPLATE_RECENT_KEY, []);
  return Array.isArray(value) ? value.map(String).slice(0, 30) : [];
}

function rememberMesssTemplate(id) {
  const next = [String(id), ...messsTemplateRecentIds().filter((entry) => entry !== id)].slice(0, 30);
  try { localStorage.setItem(MESSS_TEMPLATE_RECENT_KEY, JSON.stringify(next)); } catch (error) {}
}

function messsTemplateCategoryLabel(category, item = null) {
  const fixed = MESSS_TEMPLATE_CATEGORIES[category];
  if (fixed) return messsTemplateText(fixed[0], fixed[1]);
  return messsTemplateText(item?.categoryLabelEn || category, item?.categoryLabelZh || category);
}

function messsTemplateVisibleItems() {
  const query = MesssTemplateState.query.toLowerCase();
  const recent = new Set(messsTemplateRecentIds());
  return MesssTemplateState.items.filter((item) => {
    if (MesssTemplateState.view === 'recent' && !recent.has(item.id)) return false;
    if (MesssTemplateState.category !== 'all' && item.category !== MesssTemplateState.category) return false;
    return !query || `${item.title} ${item.description} ${messsTemplateCategoryLabel(item.category, item)}`.toLowerCase().includes(query);
  }).sort((left, right) => MesssTemplateState.view === 'recent'
    ? messsTemplateRecentIds().indexOf(left.id) - messsTemplateRecentIds().indexOf(right.id)
    : left.sortOrder - right.sortOrder);
}

function closeMesssTemplateLibrary() {
  const overlay = document.getElementById('messs-template-library');
  if (!overlay) return;
  overlay.classList.add('is-closing');
  setTimeout(() => overlay.remove(), 170);
}

function createMesssTemplateCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `messs-template-card is-${item.tone}`;
  card.dataset.templateId = item.id;
  const visual = document.createElement('span');
  visual.className = 'messs-template-card-visual';
  if (item.imageUrl) {
    const image = document.createElement('img');
    image.src = item.imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove(), { once: true });
    visual.append(image);
  }
  visual.insertAdjacentHTML('beforeend', '<i></i><i></i><i></i>');
  const badge = document.createElement('em');
  badge.textContent = item.kind === 'video' ? messsTemplateText('Video', '视频') : messsTemplateText('Image', '图片');
  visual.append(badge);
  const copy = document.createElement('span');
  copy.className = 'messs-template-card-copy';
  const title = document.createElement('strong'); title.textContent = item.title;
  const description = document.createElement('small'); description.textContent = item.description || messsTemplateCategoryLabel(item.category, item);
  copy.append(title, description);
  card.append(visual, copy);
  card.addEventListener('click', () => {
    rememberMesssTemplate(item.id);
    const select = MesssTemplateState.onSelect;
    closeMesssTemplateLibrary();
    if (typeof select === 'function') select(item);
  });
  return card;
}

function renderMesssTemplateLibrary() {
  const overlay = document.getElementById('messs-template-library');
  if (!overlay) return;
  overlay.querySelectorAll('[data-template-view]').forEach((button) => {
    const active = button.dataset.templateView === MesssTemplateState.view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const categories = ['all', ...new Set(MesssTemplateState.items.map((item) => item.category))];
  const categoryHost = overlay.querySelector('.messs-template-categories');
  categoryHost.replaceChildren(...categories.map((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.templateCategory = category;
    button.textContent = messsTemplateCategoryLabel(category, MesssTemplateState.items.find((item) => item.category === category));
    button.classList.toggle('is-active', category === MesssTemplateState.category);
    button.addEventListener('click', () => { MesssTemplateState.category = category; renderMesssTemplateLibrary(); });
    return button;
  }));
  const items = messsTemplateVisibleItems();
  overlay.querySelector('.messs-template-grid').replaceChildren(...items.map(createMesssTemplateCard));
  const empty = overlay.querySelector('.messs-template-empty');
  empty.hidden = items.length > 0;
  empty.textContent = MesssTemplateState.view === 'recent'
    ? messsTemplateText('Templates you use will appear here.', '使用过的模板会出现在这里。')
    : messsTemplateText('No matching templates.', '没有匹配的模板。');
}

function openMesssTemplateLibrary(options = {}) {
  document.getElementById('messs-template-library')?.remove();
  MesssTemplateState.onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
  MesssTemplateState.query = '';
  MesssTemplateState.category = 'all';
  MesssTemplateState.view = 'all';
  const overlay = document.createElement('div');
  overlay.id = 'messs-template-library';
  overlay.className = 'messs-template-overlay';
  overlay.innerHTML = `
    <button type="button" class="messs-template-backdrop" aria-label="${messsTemplateText('Close templates', '关闭模板库')}"></button>
    <section class="messs-template-dialog" role="dialog" aria-modal="true" aria-labelledby="messs-template-title">
      <header class="messs-template-header">
        <div class="messs-template-views" role="tablist">
          <button type="button" class="is-active" data-template-view="all" role="tab">${messsTemplateText('All templates', '全部模板')}</button>
          <button type="button" data-template-view="recent" role="tab">${messsTemplateText('Recently used', '最近使用')}</button>
        </div>
        <label class="messs-template-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          <input type="search" autocomplete="off" placeholder="${messsTemplateText('Search templates', '搜索模板')}">
        </label>
        <button type="button" class="messs-template-close" aria-label="${messsTemplateText('Close', '关闭')}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="messs-template-categories" aria-label="${messsTemplateText('Template categories', '模板分类')}"></div>
      <main class="messs-template-content">
        <h2 id="messs-template-title">${messsTemplateText('Choose a starting point', '选择一个创作起点')}</h2>
        <div class="messs-template-grid"></div>
        <p class="messs-template-empty" hidden></p>
      </main>
    </section>`;
  document.body.append(overlay);
  overlay.querySelector('.messs-template-backdrop').addEventListener('click', closeMesssTemplateLibrary);
  overlay.querySelector('.messs-template-close').addEventListener('click', closeMesssTemplateLibrary);
  overlay.querySelector('.messs-template-search input').addEventListener('input', (event) => {
    MesssTemplateState.query = event.target.value.trim();
    renderMesssTemplateLibrary();
  });
  overlay.querySelectorAll('[data-template-view]').forEach((button) => button.addEventListener('click', () => {
    MesssTemplateState.view = button.dataset.templateView;
    renderMesssTemplateLibrary();
  }));
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeMesssTemplateLibrary(); }
  });
  renderMesssTemplateLibrary();
  overlay.querySelector('.messs-template-search input').focus({ preventScroll: true });
  void loadMesssTemplates();
}

window.openMesssTemplateLibrary = openMesssTemplateLibrary;
