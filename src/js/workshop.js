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
      || (WorkshopState.category === 'mine' && (post.localOnly || post.ownerId === 'local' || post.ownerId === WorkshopState.currentUserId))
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
    media.controls = detail;
  }
  media.addEventListener('error', () => {
    frame.classList.add('is-missing');
    media.remove();
    frame.append(workshopCreateIcon(post.kind), document.createTextNode(workshopText('Media unavailable', '媒体暂不可用')));
  }, { once: true });
  frame.appendChild(media);
  if (post.kind === 'video' && !detail) {
    const badge = document.createElement('span');
    badge.className = 'workshop-media-badge';
    badge.textContent = workshopText('VIDEO', '视频');
    frame.appendChild(badge);
  }
  return frame;
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
  if (visible) {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
  } else {
    overlay.classList.remove('is-visible');
    window.setTimeout(() => { overlay.hidden = true; }, 170);
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
  WorkshopState.publishFileIds = selectedWorkshopFileIds();
  WorkshopState.publishFileId = WorkshopState.publishFileIds[0] || null;
  const form = document.getElementById('workshop-publish-form');
  if (form) form.reset();
  const status = document.getElementById('workshop-publish-status');
  if (status) status.textContent = '';
  renderWorkshopPublishSelection();
  setWorkshopOverlay('workshop-publish-overlay', true);
}

function closeWorkshopPublish() {
  setWorkshopOverlay('workshop-publish-overlay', false);
}

function workshopBeginCanvasSelection() {
  closeWorkshopPublish();
  WorkshopState.publishFileIds = [];
  WorkshopState.publishFileId = null;
  document.querySelector('.section-tab[data-section="messs"]')?.click();
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

async function publishWorkshop() {
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
  if (status) status.textContent = workshopText('Publishing...', '正在发布...');
  const kind = isVideoExt(file.ext) ? 'video' : 'image';
  let published = null;
  let cloud = false;
  try {
    if (window.messsAPI?.workshop?.publish) {
      const result = await window.messsAPI.workshop.publish(file.id, metadata);
      if (result && result.ok && result.post) {
        published = workshopNormalizePost({ ...result.post, sourceFileId: file.id });
        cloud = true;
      }
    }
  } catch (error) {}
  if (!published) {
    published = workshopNormalizePost({
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId: 'local',
      ownerName: workshopText('Me', '我'),
      ...metadata,
      kind,
      sourceFileId: file.id,
      sourceFileName: file.name,
      prompt: workshopPostPrompt({ sourceFileId: file.id }),
      createdAt: new Date().toISOString(),
      localOnly: true
    });
  }
  WorkshopState.posts = [published, ...WorkshopState.posts.filter((post) => post.id !== published.id)];
  persistWorkshopPost(published);
  renderWorkshop();
  closeWorkshopPublish();
  workshopToast(cloud
    ? workshopText('Published to Workshop.', '已发布到创意工坊。')
    : workshopText('Saved locally. Sign in and deploy Workshop storage to share publicly.', '已保存到本地。登录并部署工坊存储后即可公开分享。'));
}

function renderWorkshopDetail(post) {
  const media = document.getElementById('workshop-detail-media');
  if (media) {
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
  document.querySelector('.section-tab[data-section="messs"]')?.click();
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

async function deleteWorkshopPost() {
  const post = WorkshopState.activePost;
  if (!workshopCanDeletePost(post) || WorkshopState.deletingPostId) return;
  const confirmed = await showConfirmDialog({
    title: workshopText('Delete work', '删除作品'),
    message: workshopText('This work will be removed from Workshop.', '删除后作品将从创意工坊移除。'),
    confirmLabel: workshopText('Delete', '删除'),
    cancelLabel: workshopText('Cancel', '取消'),
    danger: true
  });
  if (!confirmed) return;

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
    closeWorkshopDetail();
    renderWorkshop();
    workshopToast(workshopText('Work deleted.', '作品已删除。'));
  } finally {
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.removeAttribute('aria-busy');
    }
    WorkshopState.deletingPostId = null;
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
  refreshWorkshopLanguage();
  void loadWorkshopPosts();
}

document.addEventListener('DOMContentLoaded', initWorkshop);
