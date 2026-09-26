'use strict';

const WORKSHOP_LOCAL_KEY = 'messs.workshop.posts.v1';
const WORKSHOP_MAX_LOCAL_POSTS = 200;
const WorkshopState = {
  category: 'all',
  query: '',
  sort: 'hot',
  posts: [],
  localPosts: [],
  activePost: null,
  canvasTargetId: null,
  canvasTargetResolver: null,
  publishFileIds: [],
  publishFileId: null,
  publishing: false,
  failedPublishDraft: null,
  awaitingCanvasSelection: false,
  loaded: false,
  loading: false,
  currentUserId: null,
  deletingPostId: null
};

function workshopText(en, zh) {
  return typeof t === 'function' ? t(en, zh) : zh;
}

function workshopToast(message) {
  if (typeof showToast === 'function') showToast(message, 'Workshop');
}

function workshopNormalizePost(raw) {
  if (!raw) return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  if (!id || !title) return null;
  const kind = raw.kind === 'video' ? 'video' : 'image';
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    id,
    ownerId: String(raw.ownerId || raw.owner_id || '').trim() || null,
    ownerName: String(raw.ownerName || raw.owner_name || '').trim() || workshopText('Messs creator', 'Messs 创作者'),
    title: title.slice(0, 80),
    description: String(raw.description || '').trim().slice(0, 300),
    kind,
    mediaPath: String(raw.mediaPath || raw.media_path || '').trim(),
    mediaUrl: String(raw.mediaUrl || raw.media_url || '').trim(),
    mimeType: String(raw.mimeType || raw.mime_type || '').trim(),
    sourceFileName: String(raw.sourceFileName || raw.source_file_name || '').trim(),
    sourceFileId: String(raw.sourceFileId || raw.source_file_id || '').trim() || null,
    prompt: String(raw.prompt || '').trim().slice(0, 12000),
    tags,
    clicks: Math.max(0, Math.floor(Number(raw.clicks) || 0)),
    likes: Math.max(0, Math.floor(Number(raw.likes) || 0)),
    liked: raw.liked === true,
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
    localOnly: raw.localOnly === true || id.startsWith('local-')
  };
}

function readWorkshopLocalPosts() {
  try {
    const value = JSON.parse(localStorage.getItem(WORKSHOP_LOCAL_KEY) || '[]');
    return (Array.isArray(value) ? value : []).map(workshopNormalizePost).filter(Boolean).slice(0, WORKSHOP_MAX_LOCAL_POSTS);
  } catch (error) {
    return [];
  }
}

function saveWorkshopLocalPosts() {
  WorkshopState.localPosts = WorkshopState.localPosts.slice(0, WORKSHOP_MAX_LOCAL_POSTS);
  try { localStorage.setItem(WORKSHOP_LOCAL_KEY, JSON.stringify(WorkshopState.localPosts)); } catch (error) {}
}

function workshopFile(fileId) {
  return AppState.files.find((file) => file.id === fileId) || null;
}

function workshopFileMediaSource(file, kind) {
  if (!file) return '';
  if (kind === 'video') return file.url || file.previewUrl || '';
  return file.thumbUrl || file.previewUrl || file.url || '';
}

function workshopMediaSource(post) {
  if (post.mediaUrl) return post.mediaUrl;
  return workshopFileMediaSource(workshopFile(post.sourceFileId), post.kind);
}

function workshopPostPrompt(post) {
  if (post && post.prompt) return post.prompt;
  const file = post && workshopFile(post.sourceFileId);
  return String(file && file.aiGeneration && file.aiGeneration.prompt || '').trim().slice(0, 12000);
}

function workshopCanDeletePost(post) {
  if (!post) return false;
  return post.localOnly || post.ownerId === 'local'
    || (!!WorkshopState.currentUserId && post.ownerId === WorkshopState.currentUserId);
}

function workshopFormatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return workshopText('Recently', '最近');
  return date.toLocaleDateString(typeof appLocale === 'function' ? appLocale() : 'zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function workshopCategoryLabel(kind) {
  return kind === 'video' ? workshopText('Video', '视频') : workshopText('Image', '图片');
}

function workshopVisiblePosts() {
  const query = WorkshopState.query.toLowerCase();
  const filtered = WorkshopState.posts.filter((post) => {
    const categoryMatch = WorkshopState.category === 'all'
      || (WorkshopState.category === 'mine' && workshopCanDeletePost(post))
      || post.kind === WorkshopState.category;
    const haystack = `${post.title} ${post.description} ${post.tags.join(' ')} ${post.sourceFileName}`.toLowerCase();
    return categoryMatch && (!query || haystack.includes(query));
  });
  return filtered.sort((a, b) => WorkshopState.sort === 'newest'
    ? new Date(b.createdAt) - new Date(a.createdAt)
    : b.clicks - a.clicks || new Date(b.createdAt) - new Date(a.createdAt));
}

function workshopCreateIcon(name) {
  const icon = document.createElement('span');
  icon.className = `workshop-icon is-${name}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name === 'video' ? '▶' : '＋';
  return icon;
}

function workshopCreateMedia(post, detail = false) {
  const source = workshopMediaSource(post);
  const frame = document.createElement('div');
  frame.className = `workshop-card-media${detail ? ' is-detail' : ''}`;
  if (!source) {
    frame.classList.add('is-missing');
    frame.append(workshopCreateIcon(post.kind), document.createTextNode(workshopText('Media unavailable', '媒体暂不可用')));
    return frame;
  }
  const media = post.kind === 'video' ? document.createElement('video') : document.createElement('img');
  media.src = source;
  media.alt = post.title;
  media.loading = 'lazy';
  if (post.kind === 'video') {
    media.muted = true;
    media.playsInline = true;
    media.preload = detail ? 'auto' : 'metadata';
    media.controls = false;
  }
  media.addEventListener('error', () => {
    frame.classList.add('is-missing');
    media.remove();
    frame.append(workshopCreateIcon(post.kind), document.createTextNode(workshopText('Media unavailable', '媒体暂不可用')));
  }, { once: true });
  frame.appendChild(media);
  if (detail) workshopSetupViewer(frame, media, post.kind === 'video');
  if (post.kind === 'video' && !detail) {
    const badge = document.createElement('span');
    badge.className = 'workshop-media-badge';
    badge.textContent = workshopText('VIDEO', '视频');
    frame.appendChild(badge);
  }
  return frame;
}

function workshopSetupViewer(frame, media, isVideo) {
  const controls = document.createElement('div');
  controls.className = 'workshop-viewer-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', workshopText('Media controls', '媒体控制'));
  const button = (label, symbol, action) => {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = symbol; el.title = label;
    el.setAttribute('aria-label', label); el.addEventListener('click', action);
    controls.append(el); return el;
  };
  const label = (el, text, symbol) => {
    el.title = text; el.setAttribute('aria-label', text); el.textContent = symbol;
  };
  if (isVideo) {
    const play = button(workshopText('Play', '播放'), '▶', async () => {
      if (!media.paused) return media.pause();
      try { await media.play(); } catch (_) { workshopToast(workshopText('Unable to play this video.', '暂时无法播放此视频。')); }
    });
    const syncPlay = () => label(play, media.paused ? workshopText('Play', '播放') : workshopText('Pause', '暂停'), media.paused ? '▶' : 'Ⅱ');
    media.addEventListener('play', syncPlay); media.addEventListener('pause', syncPlay); media.addEventListener('ended', syncPlay);
    const time = document.createElement('span'); time.className = 'workshop-viewer-time';
    const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '100'; seek.step = '.1'; seek.value = '0'; seek.disabled = true;
    seek.setAttribute('aria-label', workshopText('Playback position', '播放进度'));
    const format = value => { const n = Math.max(0, Math.floor(Number(value) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
    const syncTime = () => {
      const valid = Number.isFinite(media.duration) && media.duration > 0;
      seek.disabled = !valid; seek.value = valid ? String(media.currentTime / media.duration * 100) : '0';
      time.textContent = `${format(media.currentTime)} / ${format(valid ? media.duration : 0)}`;
    };
    seek.addEventListener('input', () => { if (Number.isFinite(media.duration)) media.currentTime = Number(seek.value) / 100 * media.duration; });
    for (const event of ['timeupdate', 'loadedmetadata', 'durationchange']) media.addEventListener(event, syncTime);
    controls.append(time, seek); syncTime();
    const mute = button(workshopText('Unmute', '开启声音'), '♪', () => { media.muted = !media.muted; });
    const syncMute = () => { mute.setAttribute('aria-pressed', String(!media.muted)); label(mute, media.muted ? workshopText('Unmute', '开启声音') : workshopText('Mute', '静音'), media.muted ? '♪̸' : '♪'); };
    media.addEventListener('volumechange', syncMute); syncMute();
  }
  let spatial = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let drag = null;
  const reset = () => { drag = null; frame.classList.remove('is-dragging'); media.style.transform = ''; };
  const space = button(workshopText('Spatial motion', '空间动效'), '◇', () => { spatial = !spatial; reset(); syncSpatial(); });
  const hint = document.createElement('span'); hint.className = 'workshop-viewer-hint';
  hint.textContent = workshopText('Drag to explore', '拖动感受空间'); frame.append(hint);
  function syncSpatial() { space.setAttribute('aria-pressed', String(spatial)); frame.classList.toggle('is-spatial', spatial); hint.hidden = !spatial; }
  syncSpatial();
  media.draggable = false;
  frame.addEventListener('pointerdown', event => {
    if (!spatial || event.button !== 0 || event.target.closest('.workshop-viewer-controls')) return;
    drag = { x: event.clientX, y: event.clientY }; frame.setPointerCapture(event.pointerId); frame.classList.add('is-dragging'); event.preventDefault();
  });
  frame.addEventListener('pointermove', event => {
    if (!drag) return;
    const x = Math.max(-1, Math.min(1, (event.clientX - drag.x) / 240));
    const y = Math.max(-1, Math.min(1, (event.clientY - drag.y) / 240));
    media.style.transform = `perspective(1200px) rotateX(${-y * 5}deg) rotateY(${x * 7}deg) scale(1.025)`;
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) frame.addEventListener(event, reset);
  const full = button(workshopText('Fullscreen', '全屏'), '⛶', async () => {
    try {
      if (document.fullscreenElement === frame) await document.exitFullscreen();
      else await frame.requestFullscreen();
    } catch (_) { workshopToast(workshopText('Fullscreen is unavailable.', '暂时无法进入全屏。')); }
  });
  frame.addEventListener('fullscreenchange', () => label(full, document.fullscreenElement === frame ? workshopText('Exit fullscreen', '退出全屏') : workshopText('Fullscreen', '全屏'), '⛶'));
  frame.append(controls);
}

function workshopBuildCard(post) {
  const card = document.createElement('article');
  card.className = 'workshop-card';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'workshop-card-button';
  button.setAttribute('aria-label', post.title);
  button.appendChild(workshopCreateMedia(post));

  const copy = document.createElement('div');
  copy.className = 'workshop-card-copy';
  const type = document.createElement('span');
  type.className = 'workshop-card-type';
  type.textContent = workshopCategoryLabel(post.kind);
  const title = document.createElement('h2');
  title.textContent = post.title;
  const description = document.createElement('p');
  description.textContent = post.description || workshopText('Shared from canvas', '来自画布的分享');
  const meta = document.createElement('div');
  meta.className = 'workshop-card-meta';
  const date = document.createElement('span');
  date.textContent = workshopFormatDate(post.createdAt);
  const stats = document.createElement('span');
  stats.textContent = `${post.clicks} ${workshopText('views', '次点击')} · ${post.likes} ${workshopText('likes', '赞')}`;
  meta.append(date, stats);
  copy.append(type, title, description, meta);
  button.appendChild(copy);
  button.addEventListener('click', () => openWorkshopDetail(post));
  card.appendChild(button);
  if (workshopCanDeletePost(post)) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'workshop-card-delete';
    remove.textContent = workshopText('Delete work', '删除作品');
    remove.disabled = WorkshopState.deletingPostId !== null;
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      void deleteWorkshopPost(post);
    });
    card.appendChild(remove);
  }
  return card;
}

function renderWorkshop() {
  const grid = document.getElementById('workshop-grid');
  const empty = document.getElementById('workshop-empty');
  if (!grid || !empty) return;
  const posts = workshopVisiblePosts();
  grid.replaceChildren(...posts.map(workshopBuildCard));
  empty.hidden = posts.length > 0;
}

function setWorkshopOverlay(id, visible) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  clearTimeout(overlay._workshopHideTimer);
  cancelAnimationFrame(overlay._workshopShowFrame);
  if (visible) {
    overlay.hidden = false;
    overlay._workshopShowFrame = requestAnimationFrame(() => overlay.classList.add('is-visible'));
  } else {
    overlay.classList.remove('is-visible');
    overlay._workshopHideTimer = window.setTimeout(() => { overlay.hidden = true; }, 170);
  }
}

function selectedWorkshopFileIds() {
  const ids = AppState.boardItems
    .filter((item) => item.selected && item.fileId)
    .map((item) => item.fileId);
  return [...new Set(ids)].filter((id) => {
    const file = workshopFile(id);
    return file && (isImageExt(file.ext) || isVideoExt(file.ext));
  });
}

function renderWorkshopPublishSelection() {
  const target = document.getElementById('workshop-publish-selection');
  const status = document.getElementById('workshop-publish-status');
  if (!target) return;
  target.replaceChildren();
  const files = WorkshopState.publishFileIds.map(workshopFile).filter(Boolean);
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'workshop-selection-empty';
    empty.textContent = workshopText('Select an image or video on the canvas first.', '请先在画布选中图片或视频。');
    target.appendChild(empty);
    if (status && !status.textContent) status.textContent = workshopText('Canvas selection required', '需要先选择画布素材');
    return;
  }
  files.forEach((file) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'workshop-selection-item';
    item.classList.toggle('is-active', file.id === WorkshopState.publishFileId);
    item.appendChild(workshopCreateMedia({ kind: isVideoExt(file.ext) ? 'video' : 'image', mediaUrl: workshopFileMediaSource(file, isVideoExt(file.ext) ? 'video' : 'image'), title: file.name }));
    const label = document.createElement('span');
    label.textContent = file.name;
    item.appendChild(label);
    item.addEventListener('click', () => {
      WorkshopState.publishFileId = file.id;
      renderWorkshopPublishSelection();
    });
    target.appendChild(item);
  });
  if (status && status.textContent === workshopText('Canvas selection required', '需要先选择画布素材')) status.textContent = '';
}

function openWorkshopPublish() {
  if (WorkshopState.publishing) {
    workshopToast(workshopText('Publishing in the background. You can keep working.', '正在后台发布，你可以继续操作。'));
    return;
  }
  const preserveDraft = WorkshopState.awaitingCanvasSelection;
  WorkshopState.awaitingCanvasSelection = false;
  WorkshopState.publishFileIds = selectedWorkshopFileIds();
  WorkshopState.publishFileId = WorkshopState.publishFileIds[0] || null;
  const form = document.getElementById('workshop-publish-form');
  if (form && !preserveDraft) form.reset();
  const draft = !preserveDraft && WorkshopState.failedPublishDraft;
  if (draft) {
    WorkshopState.publishFileIds = [draft.fileId];
    WorkshopState.publishFileId = draft.fileId;
    document.getElementById('workshop-publish-name').value = draft.metadata.title;
    document.getElementById('workshop-publish-description').value = draft.metadata.description;
    document.getElementById('workshop-publish-tags').value = draft.metadata.tags.join('、');
  }
  const status = document.getElementById('workshop-publish-status');
  if (status) status.textContent = '';
  renderWorkshopPublishSelection();
  setWorkshopOverlay('workshop-publish-overlay', true);
}

function closeWorkshopPublish() {
  WorkshopState.awaitingCanvasSelection = false;
  setWorkshopOverlay('workshop-publish-overlay', false);
}

function workshopBeginCanvasSelection() {
  WorkshopState.awaitingCanvasSelection = true;
  setWorkshopOverlay('workshop-publish-overlay', false);
  if (typeof closeAppSurface === 'function') closeAppSurface('workshop', { restoreFocus: false });
  if (typeof showCanvasWorkspace === 'function') showCanvasWorkspace();
  workshopToast(workshopText('Select an image or video on the canvas, then return here to share it.', '请在画布选中图片或视频，再返回这里分享。'));
}

function persistWorkshopPost(post) {
  const normalized = workshopNormalizePost(post);
  if (!normalized) return;
  const index = WorkshopState.localPosts.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) WorkshopState.localPosts[index] = { ...WorkshopState.localPosts[index], ...normalized };
  else WorkshopState.localPosts.unshift(normalized);
  saveWorkshopLocalPosts();
}

function workshopPostMetadata() {
  const title = document.getElementById('workshop-publish-name')?.value.trim() || '';
  const description = document.getElementById('workshop-publish-description')?.value.trim() || '';
  const tags = (document.getElementById('workshop-publish-tags')?.value || '')
    .split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
  return { title, description, tags };
}

function renderWorkshopPublishProgress(message, failed = false) {
  let banner = document.getElementById('workshop-publish-progress');
  if (!banner) {
    banner = document.createElement('div'); banner.id = 'workshop-publish-progress';
    banner.className = 'workshop-publish-progress'; banner.setAttribute('role', 'status');
    document.getElementById('workshop-grid')?.before(banner);
  }
  banner.replaceChildren(); banner.hidden = !message;
  banner.classList.toggle('is-error', failed);
  const text = document.createElement('span'); text.textContent = message; banner.append(text);
  if (failed) {
    const retry = document.createElement('button'); retry.type = 'button';
    retry.textContent = workshopText('Review and retry', '查看并重试');
    retry.onclick = openWorkshopPublish; banner.append(retry);
  }
}

async function publishWorkshop() {
  if (WorkshopState.publishing) return;
  const status = document.getElementById('workshop-publish-status');
  const file = workshopFile(WorkshopState.publishFileId);
  const metadata = workshopPostMetadata();
  if (!file) {
    if (status) status.textContent = workshopText('Select a canvas image or video first.', '请先选择画布中的图片或视频。');
    return;
  }
  if (!metadata.title) {
    if (status) status.textContent = workshopText('Add a title before publishing.', '请先填写标题。');
    document.getElementById('workshop-publish-name')?.focus();
    return;
  }
  WorkshopState.publishing = true;
  const draft = { fileId: file.id, metadata };
  closeWorkshopPublish();
  renderWorkshopPublishProgress(workshopText('Publishing in the background…', '正在后台发布…') + ' ' + metadata.title);
  workshopToast(workshopText('Publishing in the background. You can keep working.', '已转入后台发布，你可以继续操作。'));
  try {
    const result = await window.messsAPI?.workshop?.publish?.(file.id, metadata);
    const published = result?.ok && workshopNormalizePost({ ...result.post, sourceFileId: file.id });
    if (!published) throw new Error('publish-failed');
    WorkshopState.posts = [published, ...WorkshopState.posts.filter(post => post.id !== published.id)];
    persistWorkshopPost(published);
    WorkshopState.failedPublishDraft = null;
    renderWorkshop();
    renderWorkshopPublishProgress('');
    workshopToast(workshopText('Published to Workshop.', '已发布到创意工坊。'));
  } catch (error) {
    WorkshopState.failedPublishDraft = draft;
    const message = workshopText('Could not publish. Your draft is saved; review and retry.', '发布未完成，已保留填写内容，可查看后重试。');
    renderWorkshopPublishProgress(message, true);
    workshopToast(message);
  } finally {
    WorkshopState.publishing = false;
  }
}

function renderWorkshopDetail(post) {
  const media = document.getElementById('workshop-detail-media');
  if (media) {
    media.querySelectorAll('video').forEach(video => video.pause());
    media.replaceChildren(workshopCreateMedia(post, true));
  }
  const type = document.getElementById('workshop-detail-type');
  const title = document.getElementById('workshop-detail-title');
  const description = document.getElementById('workshop-detail-description');
  const author = document.getElementById('workshop-detail-author');
  const created = document.getElementById('workshop-detail-created');
  const tags = document.getElementById('workshop-detail-tags');
  const prompt = document.getElementById('workshop-detail-prompt');
  const descriptionRow = document.getElementById('workshop-detail-description-row');
  const promptText = workshopPostPrompt(post);
  const descriptionText = String(post.description || '').trim();
  if (type) type.textContent = workshopCategoryLabel(post.kind);
  if (title) title.textContent = post.title;
  if (description) description.textContent = descriptionText;
  if (descriptionRow) {
    descriptionRow.hidden = !descriptionText || descriptionText === promptText;
  }
  if (author) author.textContent = post.ownerName;
  if (created) created.textContent = workshopFormatDate(post.createdAt);
  if (tags) {
    tags.replaceChildren(...post.tags.map((tag) => {
      const chip = document.createElement('span');
      chip.textContent = `#${tag}`;
      return chip;
    }));
  }
  if (prompt) {
    prompt.hidden = !promptText;
    prompt.querySelector('p').textContent = promptText;
  }
  const like = document.getElementById('workshop-detail-like');
  const share = document.getElementById('workshop-detail-share');
  const canvas = document.getElementById('workshop-detail-canvas');
  const deleteButton = document.getElementById('workshop-detail-delete');
  if (like) like.textContent = `${post.liked ? '♥' : '♡'} ${post.likes} ${workshopText('Like', '点赞')}`;
  if (share) share.textContent = workshopText('Share', '分享');
  if (canvas) {
    const available = !!workshopPostPrompt(post) && !!workshopMediaSource(post);
    canvas.textContent = workshopText('Open on canvas', '在画布打开');
    canvas.disabled = !available;
  }
  if (deleteButton) {
    deleteButton.hidden = !workshopCanDeletePost(post);
  }
}

async function copyWorkshopDetailText(targetSelector, label) {
  const target = document.querySelector(targetSelector);
  const value = String(target && target.textContent || '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    workshopToast(workshopText(`${label} copied.`, `已复制${label}。`));
  } catch (error) {
    workshopToast(workshopText('Copy was blocked by the system.', '系统阻止了复制操作。'));
  }
}

function workshopCanvasRecords() {
  const currentId = typeof activeCanvasId === 'function' ? activeCanvasId() : AppState.activeCanvasId;
  return [...(Array.isArray(AppState.canvases) ? AppState.canvases : [])].sort((a, b) => {
    return Number(b.pinned === true) - Number(a.pinned === true)
      || Number(b.id === currentId) - Number(a.id === currentId)
      || new Date(b.lastOpenedAt || b.updatedAt || b.createdAt || 0) - new Date(a.lastOpenedAt || a.updatedAt || a.createdAt || 0);
  });
}

function renderWorkshopCanvasTargets() {
  const list = document.getElementById('workshop-canvas-target-list');
  const empty = document.getElementById('workshop-canvas-target-empty');
  const confirm = document.getElementById('workshop-canvas-target-confirm');
  if (!list) return;
  const currentId = typeof activeCanvasId === 'function' ? activeCanvasId() : AppState.activeCanvasId;
  const canvases = workshopCanvasRecords();
  list.replaceChildren();
  canvases.forEach((canvas) => {
    const project = (AppState.canvasProjects || []).find((entry) => entry.id === canvas.projectId);
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'workshop-canvas-target-option';
    option.dataset.canvasId = canvas.id;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(canvas.id === WorkshopState.canvasTargetId));
    option.classList.toggle('is-active', canvas.id === WorkshopState.canvasTargetId);
    const icon = document.createElement('span');
    icon.className = 'workshop-canvas-target-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h8"/></svg>';
    const copy = document.createElement('span');
    copy.className = 'workshop-canvas-target-copy';
    const name = document.createElement('strong');
    name.textContent = canvas.name || workshopText('Untitled canvas', '未命名画布');
    const meta = document.createElement('small');
    const projectName = project ? project.name : workshopText('General', '常规');
    meta.textContent = `${projectName}${canvas.id === currentId ? ` · ${workshopText('Current', '当前')}` : ''}`;
    copy.append(name, meta);
    const check = document.createElement('i');
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    option.append(icon, copy, check);
    list.appendChild(option);
  });
  if (empty) empty.hidden = canvases.length > 0;
  if (confirm) confirm.disabled = !canvases.length || !WorkshopState.canvasTargetId;
}

function finishWorkshopCanvasTarget(canvasId = null) {
  const resolver = WorkshopState.canvasTargetResolver;
  WorkshopState.canvasTargetResolver = null;
  WorkshopState.canvasTargetId = null;
  setWorkshopOverlay('workshop-canvas-target-overlay', false);
  if (resolver) resolver(canvasId);
}

function chooseWorkshopCanvasTarget() {
  const overlay = document.getElementById('workshop-canvas-target-overlay');
  const canvases = workshopCanvasRecords();
  if (!overlay || !canvases.length) {
    workshopToast(workshopText('Create a canvas before opening this work.', '请先创建一个画布，再打开这个作品。'));
    return Promise.resolve(null);
  }
  if (WorkshopState.canvasTargetResolver) finishWorkshopCanvasTarget(null);
  const currentId = typeof activeCanvasId === 'function' ? activeCanvasId() : AppState.activeCanvasId;
  WorkshopState.canvasTargetId = (canvases.find((canvas) => canvas.id === currentId) || canvases[0]).id;
  renderWorkshopCanvasTargets();
  setWorkshopOverlay('workshop-canvas-target-overlay', true);
  return new Promise((resolve) => { WorkshopState.canvasTargetResolver = resolve; });
}

async function recordWorkshopClick(post) {
  post.clicks += 1;
  persistWorkshopPost(post);
  renderWorkshop();
  if (post.localOnly || !window.messsAPI?.workshop?.incrementClick) return;
  const result = await window.messsAPI.workshop.incrementClick(post.id).catch(() => null);
  if (result && result.ok && result.post) {
    const update = workshopNormalizePost({ ...result.post, sourceFileId: post.sourceFileId });
    if (update) {
      Object.assign(post, update);
      persistWorkshopPost(post);
      renderWorkshop();
    }
  }
}

function openWorkshopDetail(post) {
  WorkshopState.activePost = post;
  renderWorkshopDetail(post);
  setWorkshopOverlay('workshop-detail-overlay', true);
  void recordWorkshopClick(post);
}

function closeWorkshopDetail() {
  const host = document.getElementById('workshop-detail-media');
  host?.querySelectorAll('video').forEach(video => video.pause());
  if (document.fullscreenElement && host?.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {});
  host?.replaceChildren();
  setWorkshopOverlay('workshop-detail-overlay', false);
  WorkshopState.activePost = null;
}

async function toggleWorkshopLike() {
  const post = WorkshopState.activePost;
  if (!post) return;
  if (post.localOnly || !window.messsAPI?.workshop?.toggleLike) {
    post.liked = !post.liked;
    post.likes = Math.max(0, post.likes + (post.liked ? 1 : -1));
  } else {
    const result = await window.messsAPI.workshop.toggleLike(post.id).catch(() => null);
    if (!result || !result.ok) {
      workshopToast(workshopText('Sign in to like this work.', '登录后才能点赞。'));
      return;
    }
    post.liked = result.liked === true;
    post.likes = Math.max(0, Math.floor(Number(result.likes) || 0));
  }
  persistWorkshopPost(post);
  renderWorkshopDetail(post);
  renderWorkshop();
}

async function shareWorkshopPost() {
  const post = WorkshopState.activePost;
  if (!post) return;
  const value = post.mediaUrl || `${post.title}\n${post.description}`;
  try {
    await navigator.clipboard.writeText(value);
    workshopToast(workshopText('Workshop link copied.', '工坊分享内容已复制。'));
  } catch (error) {
    workshopToast(workshopText('Copy was blocked by the system.', '系统阻止了复制操作。'));
  }
}

async function openWorkshopPostOnCanvas(mode = 'recreate') {
  const post = WorkshopState.activePost;
  let file = post && workshopFile(post.sourceFileId);
  const prompt = workshopPostPrompt(post);
  if (mode === 'recreate' && !prompt) return;
  const targetCanvasId = await chooseWorkshopCanvasTarget();
  if (!targetCanvasId) return;
  if (!file && window.messsAPI?.workshop?.importMedia) {
    const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default' ? AppState.activeFolderId : null;
    const result = await window.messsAPI.workshop.importMedia(post.id, folderId, targetCanvasId);
    if (!result || !result.ok || !result.file) {
      workshopToast(workshopText('The work could not be added to the canvas.', '作品无法添加到画布。'));
      return;
    }
    file = result.file;
    AppState.files = [file, ...AppState.files.filter((entry) => entry.id !== file.id)];
    renderFileList(currentFileListScope());
    renderFolderGridIfActive();
    if (result.unlocked && result.unlocked.length && typeof refreshAchievements === 'function') await refreshAchievements();
  }
  if (!file) {
    workshopToast(workshopText('The media is no longer available.', '这个作品的图片已经不可用。'));
    return;
  }
  closeWorkshopDetail();
  if (typeof closeAppSurface === 'function') closeAppSurface('workshop', { restoreFocus: false });
  if (typeof switchCanvas === 'function') switchCanvas(targetCanvasId, { enterWorkspace: true });
  else if (typeof showCanvasWorkspace === 'function') showCanvasWorkspace();
  if (typeof addFilesToBoard === 'function' && typeof boardViewportCenterCoords === 'function') {
    await addFilesToBoard([file.id], boardViewportCenterCoords().x, boardViewportCenterCoords().y, { selectAdded: true });
  }
  if (typeof openAiComposerForSelection === 'function') {
    await openAiComposerForSelection(post.kind === 'video' ? 'video' : 'image', prompt, {
      referenceFileIds: file ? [file.id] : []
    });
  }
}

async function deleteWorkshopPost(post = WorkshopState.activePost) {
  if (!workshopCanDeletePost(post) || WorkshopState.deletingPostId) return;
  WorkshopState.deletingPostId = post.id;
  try {
  const confirmed = await showConfirmDialog({
    title: workshopText('Delete work', '删除作品'),
    message: workshopText('This work will be removed from Workshop.', '删除后作品将从创意工坊移除。'),
    confirmLabel: workshopText('Delete', '删除'),
    cancelLabel: workshopText('Cancel', '取消'),
    danger: true
  });
  if (!confirmed || !workshopCanDeletePost(post)) return;

  WorkshopState.deletingPostId = post.id;
  const deleteButton = document.getElementById('workshop-detail-delete');
  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.setAttribute('aria-busy', 'true');
  }
  try {
    if (post.localOnly || post.ownerId === 'local') {
      WorkshopState.localPosts = WorkshopState.localPosts.filter((entry) => entry.id !== post.id);
    } else {
      const deleteApi = window.messsAPI?.workshop?.delete;
      let result = null;
      try { result = deleteApi ? await deleteApi(post.id) : null; } catch (error) {}
      if (!result || !result.ok) {
        const reason = result && result.reason;
        const message = reason === 'auth-required'
          ? workshopText('Sign in before deleting this work.', '请登录后再删除这个作品。')
          : reason === 'not-owner'
            ? workshopText('Only your own work can be deleted.', '只能删除自己发布的作品。')
            : workshopText('The work could not be deleted. Please try again.', '作品删除失败，请稍后重试。');
        workshopToast(message);
        return;
      }
      WorkshopState.localPosts = WorkshopState.localPosts.filter((entry) => entry.id !== post.id);
    }
    saveWorkshopLocalPosts();
    WorkshopState.posts = WorkshopState.posts.filter((entry) => entry.id !== post.id);
    if (WorkshopState.activePost?.id === post.id) closeWorkshopDetail();
    renderWorkshop();
    workshopToast(workshopText('Work deleted.', '作品已删除。'));
  } finally {
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.removeAttribute('aria-busy');
    }
    WorkshopState.deletingPostId = null;
  }
  } finally {
    WorkshopState.deletingPostId = null;
    renderWorkshop();
  }
}

async function loadWorkshopPosts() {
  if (WorkshopState.loading) return;
  WorkshopState.loading = true;
  WorkshopState.localPosts = readWorkshopLocalPosts();
  WorkshopState.posts = WorkshopState.localPosts.slice();
  renderWorkshop();
  try {
    try {
      const session = window.messsAPI?.getCloudSession ? await window.messsAPI.getCloudSession() : null;
      WorkshopState.currentUserId = String(session && session.user && session.user.id || '').trim() || null;
    } catch (error) {
      WorkshopState.currentUserId = null;
    }
    const result = window.messsAPI?.workshop?.list ? await window.messsAPI.workshop.list() : null;
    const remote = result && result.ok ? result.posts.map(workshopNormalizePost).filter(Boolean) : [];
    const remoteById = new Map(remote.map((post) => [post.id, post]));
    WorkshopState.localPosts.forEach((local) => {
      const current = remoteById.get(local.id);
      if (current) Object.assign(current, { sourceFileId: local.sourceFileId, liked: local.liked });
      else remote.push(local);
    });
    WorkshopState.posts = remote;
    WorkshopState.loaded = true;
    renderWorkshop();
  } finally {
    WorkshopState.loading = false;
  }
}

function refreshWorkshopLanguage() {
  const heading = document.querySelector('.workshop-heading h1');
  const subheading = document.querySelector('.workshop-heading p');
  if (heading) heading.textContent = workshopText('Creative Workshop', '创意工坊');
  if (subheading) subheading.textContent = workshopText('Share canvas inspiration and discover work by view count.', '从画布分享灵感，按点击热度发现好作品。');
  document.querySelectorAll('[data-workshop-category]').forEach((button) => {
    const labels = { all: ['All', '全部'], image: ['Images', '图片'], video: ['Videos', '视频'], mine: ['My shares', '我的分享'] };
    const label = labels[button.dataset.workshopCategory];
    if (label) button.textContent = workshopText(label[0], label[1]);
  });
  const search = document.getElementById('workshop-search-input');
  if (search) search.placeholder = workshopText('Search shared work', '搜索分享内容');
  const publishOpen = document.getElementById('workshop-publish-open');
  if (publishOpen) publishOpen.querySelector('span').textContent = workshopText('Share work', '分享作品');
  const publishTitle = document.getElementById('workshop-publish-title');
  if (publishTitle) publishTitle.textContent = workshopText('Share work', '分享作品');
  const promptLabel = document.querySelector('#workshop-detail-prompt > header > span');
  if (promptLabel) promptLabel.textContent = workshopText('Image prompt', '图片提示词');
  const copyLabels = [
    ['workshop-copy-title', 'Copy title', '复制标题'],
    ['workshop-copy-description', 'Copy description', '复制描述'],
    ['workshop-copy-prompt', 'Copy prompt', '复制提示词']
  ];
  copyLabels.forEach(([id, en, zh]) => {
    const button = document.getElementById(id);
    if (!button) return;
    const label = workshopText(en, zh);
    button.title = label;
    button.setAttribute('aria-label', label);
  });
  const deleteButton = document.getElementById('workshop-detail-delete');
  if (deleteButton) deleteButton.textContent = workshopText('Delete work', '删除作品');
  const canvasTargetTitle = document.getElementById('workshop-canvas-target-title');
  const canvasTargetKicker = document.getElementById('workshop-canvas-target-kicker');
  const canvasTargetDescription = document.getElementById('workshop-canvas-target-description');
  const canvasTargetCancel = document.getElementById('workshop-canvas-target-cancel');
  const canvasTargetConfirm = document.getElementById('workshop-canvas-target-confirm');
  if (canvasTargetTitle) canvasTargetTitle.textContent = workshopText('Choose a canvas', '选择目标画布');
  if (canvasTargetKicker) canvasTargetKicker.textContent = workshopText('Canvas', '画布');
  if (canvasTargetDescription) canvasTargetDescription.textContent = workshopText('The image and prompt will be sent to the selected canvas.', '图片和提示词会一起发送到你选择的画布。');
  if (canvasTargetCancel) canvasTargetCancel.textContent = workshopText('Cancel', '取消');
  if (canvasTargetConfirm) canvasTargetConfirm.textContent = workshopText('Send to canvas', '发送到画布');
  renderWorkshop();
  if (WorkshopState.activePost) renderWorkshopDetail(WorkshopState.activePost);
}

function initWorkshop() {
  if (!document.getElementById('workshop-grid')) return;
  document.getElementById('workshop-publish-open')?.addEventListener('click', openWorkshopPublish);
  document.getElementById('section-workshop')?.addEventListener('messs:surface-opened', () => {
    if (WorkshopState.awaitingCanvasSelection) openWorkshopPublish();
    void loadWorkshopPosts();
  });
  document.getElementById('workshop-publish-close')?.addEventListener('click', closeWorkshopPublish);
  document.getElementById('workshop-detail-close')?.addEventListener('click', closeWorkshopDetail);
  document.getElementById('workshop-select-from-canvas')?.addEventListener('click', workshopBeginCanvasSelection);
  document.getElementById('workshop-publish-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void publishWorkshop();
  });
  document.getElementById('workshop-detail-like')?.addEventListener('click', () => { void toggleWorkshopLike(); });
  document.getElementById('workshop-detail-share')?.addEventListener('click', () => { void shareWorkshopPost(); });
  document.getElementById('workshop-detail-canvas')?.addEventListener('click', () => { void openWorkshopPostOnCanvas('recreate'); });
  document.getElementById('workshop-copy-title')?.addEventListener('click', () => { void copyWorkshopDetailText('#workshop-detail-title', workshopText('Title', '标题')); });
  document.getElementById('workshop-copy-description')?.addEventListener('click', () => { void copyWorkshopDetailText('#workshop-detail-description', workshopText('Description', '描述')); });
  document.getElementById('workshop-copy-prompt')?.addEventListener('click', () => { void copyWorkshopDetailText('#workshop-detail-prompt > p', workshopText('Prompt', '提示词')); });
  document.getElementById('workshop-detail-delete')?.addEventListener('click', () => { void deleteWorkshopPost(); });
  document.getElementById('workshop-canvas-target-close')?.addEventListener('click', () => finishWorkshopCanvasTarget(null));
  document.getElementById('workshop-canvas-target-cancel')?.addEventListener('click', () => finishWorkshopCanvasTarget(null));
  document.getElementById('workshop-canvas-target-confirm')?.addEventListener('click', () => finishWorkshopCanvasTarget(WorkshopState.canvasTargetId));
  document.getElementById('workshop-canvas-target-overlay')?.addEventListener('click', (event) => {
    if (event.target.id === 'workshop-canvas-target-overlay') finishWorkshopCanvasTarget(null);
  });
  document.getElementById('workshop-canvas-target-list')?.addEventListener('click', (event) => {
    const option = event.target.closest('[data-canvas-id]');
    if (!option) return;
    WorkshopState.canvasTargetId = option.dataset.canvasId;
    renderWorkshopCanvasTargets();
  });
  document.getElementById('workshop-categories')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-workshop-category]');
    if (!button) return;
    WorkshopState.category = button.dataset.workshopCategory;
    document.querySelectorAll('[data-workshop-category]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    renderWorkshop();
  });
  document.getElementById('workshop-search-input')?.addEventListener('input', (event) => {
    WorkshopState.query = event.target.value.trim();
    renderWorkshop();
  });
  document.getElementById('workshop-sort')?.addEventListener('change', (event) => {
    WorkshopState.sort = event.target.value;
    renderWorkshop();
  });
  ['workshop-publish-overlay', 'workshop-detail-overlay'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (event) => {
      if (event.target !== event.currentTarget) return;
      id === 'workshop-publish-overlay' ? closeWorkshopPublish() : closeWorkshopDetail();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('workshop-canvas-target-overlay')?.hidden) finishWorkshopCanvasTarget(null);
    else if (!document.getElementById('workshop-detail-overlay')?.hidden) closeWorkshopDetail();
    else if (!document.getElementById('workshop-publish-overlay')?.hidden) closeWorkshopPublish();
  });
  document.addEventListener('messs:language-changed', refreshWorkshopLanguage);
  const unsubscribeSession = window.messsAPI?.onCloudSessionChanged?.((session) => {
    WorkshopState.currentUserId = String(session?.user?.id || '').trim() || null;
    renderWorkshop();
    if (WorkshopState.activePost) renderWorkshopDetail(WorkshopState.activePost);
  });
  window.addEventListener('beforeunload', () => unsubscribeSession?.(), { once: true });
  refreshWorkshopLanguage();
  void loadWorkshopPosts();
}

document.addEventListener('DOMContentLoaded', initWorkshop);
