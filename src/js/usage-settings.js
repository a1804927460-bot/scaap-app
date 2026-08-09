'use strict';

const UsageSettings = {
  range: '30',
  summary: null,
  requestRevision: 0,
  cache: new Map(),
  state: 'idle',
  errorKind: '',
  initialized: false
};

const USAGE_CACHE_MS = 30_000;
const USAGE_TYPE_COLORS = Object.freeze({
  image: '#b76b4f',
  video: '#527f9e',
  '3d': '#5d8b72',
  chat: '#8a6f9d',
  other: '#8a7769'
});
const USAGE_MODEL_NAMES = Object.freeze({
  'image-1': 'Nano Banana Pro',
  'image-2': 'Nano Banana 2',
  'image-3': 'Seedream 5.0',
  'image-4': 'Midjourney Turbo',
  'image-5': 'Nano Banana 2 Lite',
  'image-6': 'GPT Image 2',
  'image-7': 'Higgsfield Soul Standard',
  'image-8': 'Higgsfield Soul',
  'image-9': 'Nano Banana',
  'image-10': 'Seedream 5.0 Pro',
  'image-11': 'Seedream 4.5',
  'image-12': 'Seedream 4.0',
  'image-13': 'Seedream 3.0',
  'image-14': 'SeedEdit 3.0',
  'image-15': 'Kling Image 2',
  'image-16': 'Jimeng Drawing 3.0',
  'video-1': 'MiniMax H3',
  'video-2': 'Seedance 2.0',
  'video-3': 'Seedance 2.5',
  'video-4': 'Seedance 2.0 Fast',
  'video-5': 'Seedance 1.5 Pro',
  'video-6': 'Seedance 1.0 Pro',
  'video-7': 'Seedance 1.0 Lite',
  'video-8': 'Jimeng Video 3.0',
  'video-9': 'Jimeng Video 3.0 Pro',
  'topaz-image-sharpen': 'Topaz Image Sharpen',
  'topaz-image-sharpen-gen': 'Topaz Generative Sharpen',
  'topaz-image-enhance': 'Topaz Image Enhance',
  'topaz-image-enhance-gen': 'Topaz Generative Enhance',
  'topaz-image-denoise': 'Topaz Image Denoise',
  'topaz-image-restore': 'Topaz Image Restore',
  'topaz-image-lighting': 'Topaz Image Relight',
  'chat-1': 'Messs AI',
  'chat-2': 'AI Chat',
  'topaz-video-upscale': 'Topaz Video AI',
  hunyuan3d: 'Hunyuan3D',
  hyper3d: 'Hyper3D',
  tripo3d: 'Tripo3D'
});

function usageText(english, chinese, korean) {
  if (typeof t === 'function') return t(english, chinese, korean);
  return english;
}

function usageNumber(value) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  try {
    return new Intl.NumberFormat(typeof appLocale === 'function' ? appLocale() : 'en-US').format(safe);
  } catch (error) {
    return String(safe);
  }
}

function usageDecimalNumber(value) {
  const safe = Math.max(0, Number(value) || 0);
  try {
    return new Intl.NumberFormat(typeof appLocale === 'function' ? appLocale() : 'en-US', {
      maximumFractionDigits: 2
    }).format(safe);
  } catch (error) {
    return String(Math.round(safe * 100) / 100);
  }
}

function usageDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '-';
  try {
    return new Intl.DateTimeFormat(typeof appLocale === 'function' ? appLocale() : 'en-US', {
      month: 'short',
      day: 'numeric'
    }).format(new Date(`${raw}T12:00:00Z`));
  } catch (error) {
    return raw;
  }
}

function usagePeriodText(range = UsageSettings.range) {
  if (range === '7') return usageText('Last 7 days', '最近 7 天', '최근 7일');
  if (range === 'all') return usageText('All time', '全部时间', '전체 기간');
  return usageText('Last 30 days', '最近 30 天', '최근 30일');
}

function usageLoadErrorMessage(kind = 'generic') {
  if (kind === 'unsupported') {
    return usageText(
      'This build does not include usage reporting.',
      '当前版本未包含用量统计。',
      '이 버전에는 사용량 통계가 포함되어 있지 않습니다.'
    );
  }
  if (kind === 'schema') {
    return usageText(
      'Usage reporting is still being configured. Point redemption remains available.',
      '用量统计仍在配置中，积分兑换仍可使用。',
      '사용량 통계를 구성하는 중입니다. 포인트 교환은 계속 사용할 수 있습니다.'
    );
  }
  return usageText(
    'Could not load your usage right now. Point redemption remains available.',
    '暂时无法加载用量，积分兑换仍可使用。',
    '현재 사용량을 불러올 수 없습니다. 포인트 교환은 계속 사용할 수 있습니다.'
  );
}

function safeUsageRows(value, mapper) {
  return Array.isArray(value) ? value.map(mapper).filter(Boolean) : [];
}

function normalizeUsageSummary(payload) {
  const envelope = payload && typeof payload === 'object' ? payload : {};
  const raw = envelope.summary && typeof envelope.summary === 'object' ? envelope.summary : envelope;
  const authenticated = envelope.authenticated === false || raw.authenticated === false
    ? false
    : Boolean(envelope.authenticated === true || raw.authenticated === true || envelope.summary);
  const accountRaw = raw.account && typeof raw.account === 'object' ? raw.account : {};
  const totalsRaw = raw.totals && typeof raw.totals === 'object' ? raw.totals : {};
  const periodRaw = raw.period && typeof raw.period === 'object' ? raw.period : {};
  const balance = Math.max(0, Number(accountRaw.balance) || 0);
  const reserved = Math.max(0, Math.min(balance, Number(accountRaw.reserved) || 0));
  const available = Math.max(0, Number(accountRaw.availableCredits ?? accountRaw.available) || balance - reserved);
  const credits = Math.max(0, Number(totalsRaw.credits ?? totalsRaw.creditsConsumed) || 0);
  const generations = Math.max(0, Number(totalsRaw.generations ?? totalsRaw.generationCount) || 0);
  const average = Math.max(0, Number(totalsRaw.averagePerDay ?? totalsRaw.dailyAverage) || 0);
  const byType = safeUsageRows(raw.byType, (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const kind = String(entry.kind || entry.type || 'other').trim().toLowerCase() || 'other';
    return {
      kind: Object.hasOwn(USAGE_TYPE_COLORS, kind) ? kind : 'other',
      credits: Math.max(0, Number(entry.credits) || 0),
      requests: Math.max(0, Number(entry.requests ?? entry.generations) || 0)
    };
  });
  const daily = safeUsageRows(raw.daily, (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const date = String(entry.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return {
      date,
      credits: Math.max(0, Number(entry.credits) || 0),
      requests: Math.max(0, Number(entry.requests ?? entry.generations) || 0)
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
  const modelsRaw = raw.byModel || raw.topModels;
  const byModel = safeUsageRows(modelsRaw, (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const providerId = String(entry.providerId || entry.provider_id || '').trim().slice(0, 128);
    if (!providerId) return null;
    return {
      providerId,
      kind: String(entry.kind || 'other').trim().toLowerCase(),
      credits: Math.max(0, Number(entry.credits) || 0),
      requests: Math.max(0, Number(entry.requests ?? entry.generations) || 0)
    };
  });
  return {
    authenticated,
    account: {
      balance,
      reserved,
      available,
      membershipTier: String(accountRaw.membershipTier || accountRaw.membership_tier || 'free').slice(0, 40) || 'free'
    },
    totals: { credits, generations, average },
    period: {
      from: String(periodRaw.from || raw.firstUsageAt || '').slice(0, 10),
      to: String(periodRaw.to || raw.lastUsageAt || '').slice(0, 10),
      days: Math.max(0, Number(periodRaw.days ?? totalsRaw.dayCount) || 0)
    },
    byType,
    daily,
    byModel
  };
}

function fillUsageRange(rows, range) {
  if (range === 'all') return rows;
  const days = range === '7' ? 7 : 30;
  const values = new Map(rows.map((row) => [row.date, row]));
  const latest = rows.length && /^\d{4}-\d{2}-\d{2}$/.test(rows[rows.length - 1].date)
    ? new Date(`${rows[rows.length - 1].date}T12:00:00Z`)
    : new Date();
  const today = new Date();
  if (latest < today) latest.setTime(today.getTime());
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(latest);
    date.setUTCDate(latest.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    result.push(values.get(key) || { date: key, credits: 0, requests: 0 });
  }
  return result;
}

function smoothUsagePath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const handle = (current.x - previous.x) / 3;
    path += ` C ${(previous.x + handle).toFixed(2)} ${previous.y.toFixed(2)}`;
    path += ` ${(current.x - handle).toFixed(2)} ${current.y.toFixed(2)}`;
    path += ` ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
  }
  return path;
}

function renderUsageTrend(summary) {
  const svg = document.getElementById('usage-trend-chart');
  const line = document.getElementById('usage-trend-line');
  const area = document.getElementById('usage-trend-area');
  const pointsGroup = document.getElementById('usage-trend-points');
  const empty = document.getElementById('usage-trend-empty');
  const rows = fillUsageRange(summary.daily, UsageSettings.range);
  const active = rows.some((row) => row.credits > 0 || row.requests > 0);
  const max = rows.reduce((highest, row) => Math.max(highest, row.credits), 0);
  document.getElementById('usage-trend-peak').textContent = `${usageNumber(max)} ${usageText('peak', '峰值', '최고')}`;
  document.getElementById('usage-chart-from').textContent = usageDate(rows[0] && rows[0].date || summary.period.from);
  document.getElementById('usage-chart-to').textContent = usageDate(rows[rows.length - 1] && rows[rows.length - 1].date || summary.period.to);
  svg.hidden = !active;
  empty.hidden = active;
  line.setAttribute('d', '');
  area.setAttribute('d', '');
  pointsGroup.replaceChildren();
  if (!active || !rows.length) return;

  const left = 18;
  const right = 702;
  const top = 20;
  const bottom = 190;
  const height = bottom - top;
  const scaleMax = Math.max(1, max);
  const points = rows.map((row, index) => ({
    x: rows.length === 1 ? (left + right) / 2 : left + ((right - left) * index / (rows.length - 1)),
    y: bottom - (height * row.credits / scaleMax),
    row
  }));
  const path = smoothUsagePath(points);
  line.setAttribute('d', path);
  area.setAttribute('d', `${path} L ${points[points.length - 1].x.toFixed(2)} ${bottom} L ${points[0].x.toFixed(2)} ${bottom} Z`);
  const pointStep = Math.max(1, Math.ceil(points.length / 48));
  points.forEach((point, index) => {
    if (index % pointStep !== 0 && index !== points.length - 1) return;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', point.x.toFixed(2));
    circle.setAttribute('cy', point.y.toFixed(2));
    circle.setAttribute('r', '3');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${usageDate(point.row.date)}: ${usageNumber(point.row.credits)} ${usageText('points', '积分', '포인트')}`;
    circle.appendChild(title);
    pointsGroup.appendChild(circle);
  });
  svg.setAttribute('aria-label', usageText(
    `Daily points trend, peak ${usageNumber(max)} points`,
    `每日积分趋势，峰值 ${usageNumber(max)} 积分`,
    `일별 포인트 추이, 최고 ${usageNumber(max)}포인트`
  ));
}

function usageTypeName(kind) {
  if (kind === 'image') return usageText('Image', '图片', '이미지');
  if (kind === 'video') return usageText('Video', '视频', '동영상');
  if (kind === '3d') return '3D';
  if (kind === 'chat') return usageText('AI Chat', 'AI 对话', 'AI 채팅');
  return usageText('Other', '其他', '기타');
}

function renderUsageTypes(summary) {
  const list = document.getElementById('usage-type-list');
  const donut = document.getElementById('usage-donut');
  const empty = document.getElementById('usage-types-empty');
  const rows = summary.byType.filter((row) => row.credits > 0 || row.requests > 0);
  const billed = rows.filter((row) => row.credits > 0);
  const total = billed.reduce((sum, row) => sum + row.credits, 0);
  list.replaceChildren();
  empty.hidden = rows.length > 0;
  document.getElementById('usage-donut-total').textContent = usageNumber(total);
  const segments = [];
  let cursor = 0;
  billed.forEach((row) => {
    const end = cursor + row.credits / Math.max(1, total) * 100;
    segments.push(`${USAGE_TYPE_COLORS[row.kind]} ${cursor.toFixed(2)}% ${end.toFixed(2)}%`);
    cursor = end;
  });
  donut.style.setProperty('--usage-donut', segments.length
    ? `conic-gradient(${segments.join(', ')})`
    : `conic-gradient(var(--border-hairline) 0 100%)`);
  donut.setAttribute('aria-label', usageText(
    `Points by type, ${usageNumber(total)} total`,
    `按类型消耗，共 ${usageNumber(total)} 积分`,
    `유형별 포인트, 총 ${usageNumber(total)}포인트`
  ));

  rows.sort((left, right) => right.credits - left.credits || right.requests - left.requests).forEach((row) => {
    const percentage = total > 0 ? Math.round(row.credits / total * 100) : 0;
    const item = document.createElement('div');
    item.className = 'usage-type-row';
    const marker = document.createElement('span');
    marker.className = 'usage-type-marker';
    marker.style.backgroundColor = USAGE_TYPE_COLORS[row.kind];
    const name = document.createElement('span');
    name.className = 'usage-type-name';
    name.textContent = usageTypeName(row.kind);
    const value = document.createElement('strong');
    value.textContent = usageNumber(row.credits);
    const detail = document.createElement('small');
    detail.textContent = `${percentage}% · ${usageNumber(row.requests)} ${usageText('requests', '次', '회')}`;
    item.append(marker, name, value, detail);
    list.appendChild(item);
  });
}

function usageModelName(providerId) {
  return USAGE_MODEL_NAMES[providerId] || providerId;
}

function renderUsageModels(summary) {
  const list = document.getElementById('usage-model-list');
  const empty = document.getElementById('usage-models-empty');
  const rows = summary.byModel.filter((row) => row.credits > 0 || row.requests > 0).slice(0, 8);
  const max = rows.reduce((highest, row) => Math.max(highest, row.credits), 0);
  list.replaceChildren();
  empty.hidden = rows.length > 0;
  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'usage-model-row';
    const head = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = usageModelName(row.providerId);
    name.title = usageModelName(row.providerId);
    const value = document.createElement('strong');
    value.textContent = `${usageNumber(row.credits)} ${usageText('points', '积分', '포인트')}`;
    head.append(name, value);
    const track = document.createElement('span');
    track.className = 'usage-model-track';
    const fill = document.createElement('i');
    fill.style.width = `${max > 0 ? Math.max(2, row.credits / max * 100) : 0}%`;
    track.appendChild(fill);
    const requests = document.createElement('small');
    requests.textContent = `${usageNumber(row.requests)} ${usageText('requests', '次请求', '회 요청')}`;
    item.append(head, track, requests);
    list.appendChild(item);
  });
}

function renderUsageSummary(summary) {
  UsageSettings.summary = summary;
  const { account, totals } = summary;
  document.getElementById('usage-balance-value').textContent = usageNumber(account.available);
  document.getElementById('usage-total-balance').textContent = usageNumber(account.balance);
  document.getElementById('usage-reserved-value').textContent = usageNumber(account.reserved);
  document.getElementById('usage-reserved-wrap').hidden = account.reserved <= 0;
  document.getElementById('usage-plan-tier').textContent = account.membershipTier.toLowerCase() === 'free'
    ? usageText('Free', '免费', '무료')
    : account.membershipTier;
  document.getElementById('usage-total-credits').textContent = usageNumber(totals.credits);
  document.getElementById('usage-generation-count').textContent = usageNumber(totals.generations);
  document.getElementById('usage-daily-average').textContent = usageDecimalNumber(totals.average);
  const shortcutMeta = document.getElementById('usage-shortcut-meta');
  if (shortcutMeta) shortcutMeta.textContent = `${usageNumber(totals.credits)} ${usageText('points this period', '积分（本周期）', '포인트 (현재 기간)')}`;
  renderUsageTrend(summary);
  renderUsageTypes(summary);
  renderUsageModels(summary);
  refreshUsageLanguage(false);
}

function setUsageState(state, message = '', errorKind = '') {
  const loading = document.getElementById('usage-loading');
  const auth = document.getElementById('usage-auth-state');
  const error = document.getElementById('usage-error-state');
  const dashboard = document.getElementById('usage-dashboard');
  const redemption = document.getElementById('usage-redemption');
  UsageSettings.state = state;
  UsageSettings.errorKind = state === 'error' ? errorKind : '';
  loading.hidden = state !== 'loading';
  auth.hidden = state !== 'auth';
  error.hidden = state !== 'error';
  dashboard.hidden = state !== 'ready';
  if (redemption) redemption.hidden = state !== 'ready' && state !== 'error';
  if (message) document.getElementById('usage-error-message').textContent = message;
}

function resetUsageSession() {
  UsageSettings.requestRevision += 1;
  UsageSettings.cache.clear();
  UsageSettings.summary = null;
  const shortcutMeta = document.getElementById('usage-shortcut-meta');
  if (shortcutMeta) {
    shortcutMeta.textContent = usageText(
      'View points and activity',
      '查看积分与生成记录',
      '포인트와 생성 기록 보기'
    );
  }
}

async function loadUsageSummary(options = {}) {
  if (!window.messsAPI || typeof window.messsAPI.getUsageSummary !== 'function') {
    setUsageState('error', usageLoadErrorMessage('unsupported'), 'unsupported');
    return;
  }
  const range = UsageSettings.range;
  const cached = UsageSettings.cache.get(range);
  if (!options.force && cached && Date.now() - cached.savedAt < USAGE_CACHE_MS) {
    renderUsageSummary(cached.summary);
    setUsageState(cached.summary.authenticated ? 'ready' : 'auth');
    return;
  }
  const revision = ++UsageSettings.requestRevision;
  setUsageState('loading');
  try {
    const payload = await window.messsAPI.getUsageSummary(range);
    if (revision !== UsageSettings.requestRevision || range !== UsageSettings.range) return;
    const summary = normalizeUsageSummary(payload);
    if (!summary.authenticated) {
      UsageSettings.cache.delete(range);
      UsageSettings.summary = null;
      const shortcutMeta = document.getElementById('usage-shortcut-meta');
      if (shortcutMeta) shortcutMeta.textContent = usageText('Sign in for usage', '登录后查看用量', '로그인 후 사용량 보기');
      setUsageState('auth');
      return;
    }
    UsageSettings.cache.set(range, { savedAt: Date.now(), summary });
    renderUsageSummary(summary);
    setUsageState('ready');
  } catch (error) {
    if (revision !== UsageSettings.requestRevision) return;
    if (error && ['invalid-session', 'auth-required'].includes(error.code)) {
      setUsageState('auth');
      return;
    }
    const errorKind = error && error.code === 'credit-schema-missing' ? 'schema' : 'generic';
    setUsageState('error', usageLoadErrorMessage(errorKind), errorKind);
  }
}

function setSettingsView(view = 'general') {
  const target = view === 'usage' ? 'usage' : 'general';
  const manager = document.querySelector('.ai-provider-manager');
  const general = document.getElementById('settings-general-view');
  const usage = document.getElementById('settings-usage-view');
  const footer = document.getElementById('ai-provider-manager-footer');
  if (!manager || !general || !usage) return;
  manager.dataset.settingsView = target;
  general.hidden = target !== 'general';
  usage.hidden = target !== 'usage';
  if (footer) footer.hidden = target !== 'general';
  document.querySelectorAll('[data-settings-view-target]').forEach((button) => {
    const active = button.dataset.settingsViewTarget === target;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (target === 'usage') loadUsageSummary();
}

function openUsageSettings() {
  const overlay = document.getElementById('ai-provider-overlay');
  if (!overlay) return;
  const settingsPopover = document.getElementById('settings-popover');
  const accountPopover = document.getElementById('account-popover');
  if (settingsPopover) settingsPopover.hidden = true;
  if (accountPopover) accountPopover.hidden = true;
  overlay.hidden = false;
  setSettingsView('usage');
}

function refreshUsageLanguage(renderData = true) {
  const set = (selector, english, chinese, korean) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = usageText(english, chinese, korean);
  };
  const attr = (selector, name, english, chinese, korean) => {
    const node = document.querySelector(selector);
    if (node) node.setAttribute(name, usageText(english, chinese, korean));
  };
  set('#usage-settings-open strong', 'Usage', '用量', '사용량');
  if (!UsageSettings.summary) set('#usage-shortcut-meta', 'View points and activity', '查看积分与生成记录', '포인트와 생성 기록 보기');
  set('#settings-view-general', 'General', '常规', '일반');
  set('#settings-view-usage', 'Usage', '用量', '사용량');
  attr('.settings-view-tabs', 'aria-label', 'Settings sections', '设置分类', '설정 섹션');
  set('#usage-page-title', 'Usage', '用量', '사용량');
  set('#usage-period-label', usagePeriodText(), usagePeriodText(), usagePeriodText());
  attr('#usage-range-switch', 'aria-label', 'Usage period', '用量周期', '사용량 기간');
  set('[data-usage-range="7"]', '7 Days', '7 天', '7일');
  set('[data-usage-range="30"]', '30 Days', '30 天', '30일');
  set('[data-usage-range="all"]', 'All', '全部', '전체');
  set('#usage-loading > span:last-child', 'Loading usage...', '正在加载用量...', '사용량 불러오는 중...');
  set('#usage-auth-state strong', 'Sign in to view usage', '登录后查看用量', '로그인 후 사용량 보기');
  set('#usage-auth-state small', 'Your points and generation history are linked to your account.', '积分和生成记录与账号关联。', '포인트와 생성 기록은 계정에 연결됩니다.');
  set('#usage-sign-in-btn', 'Sign In', '登录', '로그인');
  set('#usage-error-state strong', 'Usage is unavailable', '用量暂不可用', '사용량을 확인할 수 없음');
  if (UsageSettings.state === 'error') {
    set('#usage-error-message', usageLoadErrorMessage(UsageSettings.errorKind), usageLoadErrorMessage(UsageSettings.errorKind), usageLoadErrorMessage(UsageSettings.errorKind));
  }
  set('#usage-retry-btn', 'Try Again', '重试', '다시 시도');
  set('#usage-balance-label', 'Available points', '可用积分', '사용 가능 포인트');
  set('.usage-balance-side > span', 'Total balance', '总余额', '총 잔액');
  set('.usage-balance-side > small', 'Points ready for image and video tools', '可用于图片与视频工具', '이미지 및 동영상 도구에 사용 가능');
  if (UsageSettings.summary && UsageSettings.summary.account.reserved > 0) {
    document.getElementById('usage-reserved-wrap').lastChild.textContent = usageText(' reserved', ' 已冻结', ' 예약됨');
  }
  set('.usage-metric:nth-child(1) > span', 'Consumed', '总消耗', '총 사용량');
  set('.usage-metric:nth-child(2) > span', 'Generation requests', '生成次数', '생성 요청');
  set('.usage-metric:nth-child(3) > span', 'Daily average', '日均消耗', '일평균 사용량');
  document.querySelectorAll('.usage-metric small').forEach((node) => { node.textContent = ` ${usageText('points', '积分', '포인트')}`; });
  set('#usage-trend-title', 'Daily points', '每日积分趋势', '일별 포인트');
  set('#usage-trend-empty', 'No usage in this period', '本周期暂无用量', '이 기간에는 사용량이 없습니다');
  set('#usage-types-title', 'By type', '按类型消耗', '유형별 사용량');
  set('#usage-types-empty', 'No billed activity', '暂无计费记录', '결제된 활동이 없습니다');
  set('#usage-models-title', 'Top models', '模型消耗排行', '모델 사용량 순위');
  set('#usage-models-empty', 'No model usage in this period', '本周期暂无模型用量', '이 기간에는 모델 사용량이 없습니다');
  set('#usage-donut small', 'points', '积分', '포인트');
  const period = usagePeriodText();
  document.getElementById('usage-types-period').textContent = period;
  document.getElementById('usage-models-period').textContent = period;
  if (renderData && UsageSettings.summary) renderUsageSummary(UsageSettings.summary);
}

function initUsageSettings() {
  if (UsageSettings.initialized || !document.getElementById('settings-usage-view')) return;
  UsageSettings.initialized = true;
  const opener = document.getElementById('usage-settings-open');
  if (opener) opener.addEventListener('click', openUsageSettings);
  document.querySelectorAll('[data-settings-view-target]').forEach((button) => {
    button.addEventListener('click', () => setSettingsView(button.dataset.settingsViewTarget));
  });
  document.querySelectorAll('[data-usage-range]').forEach((button) => {
    button.addEventListener('click', () => {
      const range = ['7', '30', 'all'].includes(button.dataset.usageRange) ? button.dataset.usageRange : '30';
      if (range === UsageSettings.range) return;
      UsageSettings.range = range;
      document.querySelectorAll('[data-usage-range]').forEach((option) => {
        const active = option.dataset.usageRange === range;
        option.classList.toggle('is-active', active);
        option.setAttribute('aria-pressed', String(active));
      });
      refreshUsageLanguage(false);
      loadUsageSummary();
    });
  });
  document.getElementById('usage-retry-btn').addEventListener('click', () => loadUsageSummary({ force: true }));
  document.getElementById('usage-sign-in-btn').addEventListener('click', () => {
    const google = document.getElementById('account-google-sign-in') || document.getElementById('cloud-account-google');
    if (google) google.click();
  });
  document.addEventListener('messs:language-changed', () => refreshUsageLanguage());
  document.addEventListener('messs:membership-updated', () => {
    resetUsageSession();
    const visible = !document.getElementById('settings-usage-view').hidden;
    if (visible) loadUsageSummary({ force: true });
  });
  document.addEventListener('messs:ai-config-updated', () => {
    resetUsageSession();
    if (!document.getElementById('settings-usage-view').hidden) loadUsageSummary({ force: true });
  });
  refreshUsageLanguage(false);
}

if (typeof window !== 'undefined') {
  window.initUsageSettings = initUsageSettings;
  window.setSettingsView = setSettingsView;
}
if (typeof module === 'object' && module.exports) {
  module.exports = { normalizeUsageSummary, fillUsageRange, smoothUsagePath, usageDecimalNumber };
}
