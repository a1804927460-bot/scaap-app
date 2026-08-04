'use strict';

function formatBoardMediaSize(file) {
  const width = Number(file.sourceWidth);
  const height = Number(file.sourceHeight);
  const fileSize = Number(file.sizeBytes);
  const parts = [];
  if (Number.isFinite(width) && Number.isFinite(height)) {
    parts.push(t(`${Math.round(width)} x ${Math.round(height)} px`, `${Math.round(width)} x ${Math.round(height)} 像素`));
  }
  if (Number.isFinite(fileSize) && fileSize >= 0) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = fileSize;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    parts.push(`${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`);
  }
  return parts.join(' | ') || t('Source size unavailable', '源文件尺寸不可用');
}

function appendBoardMediaMeta(element, file) {
  const meta = document.createElement('div');
  meta.className = 'board-media-meta';
  const name = document.createElement('strong');
  name.className = 'board-media-meta-name';
  name.textContent = file.name;
  const dimensions = document.createElement('span');
  dimensions.className = 'board-media-meta-size';
  dimensions.textContent = formatBoardMediaSize(file);
  meta.append(name, dimensions);
  element.appendChild(meta);
  return meta;
}

function formatBoardFileSize(file) {
  const fileSize = Number(file && file.sizeBytes);
  if (!Number.isFinite(fileSize) || fileSize < 0) return t('Size unavailable', '大小未知');
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = fileSize;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

let generatedMediaDetailKeyHandler = null;

const BOARD_IMAGE_TOOL_ICONS = {
  details: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6"></path><path d="M12 7h.01"></path></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>',
  more: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>'
};

function appendBoardImageToolbar(element, file, item) {
  const toolbar = document.createElement('div');
  toolbar.className = 'board-image-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', t('Image actions', '图片操作'));
  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    toolbar.addEventListener(eventName, (event) => event.stopPropagation());
  });

  const actions = [
    {
      key: 'details',
      title: t('Image details', '图片详情'),
      run: () => showGeneratedMediaDetails(file, element)
    },
    {
      key: 'fullscreen',
      title: t('View large image', '查看大图'),
      run: () => {
        if (typeof openFileFullscreenPreview === 'function') {
          openFileFullscreenPreview(file);
          return;
        }
        selectFileForPreview(file.id);
      }
    },
    {
      key: 'more',
      title: t('More actions', '更多操作'),
      run: (button) => {
        const rect = button.getBoundingClientRect();
        showBoardItemContextMenu(item, rect.right, rect.bottom + 6);
      }
    }
  ];

  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `board-image-toolbar-button is-${action.key}`;
    button.title = action.title;
    button.setAttribute('aria-label', action.title);
    button.innerHTML = BOARD_IMAGE_TOOL_ICONS[action.key];
    ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
      button.addEventListener(eventName, (event) => event.stopPropagation());
    });
    button.addEventListener('click', () => action.run(button));
    toolbar.appendChild(button);
  });

  element.appendChild(toolbar);
  return toolbar;
}

function appendGeneratedMediaDetailsControl(element, file) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'generated-media-detail-trigger';
  button.title = t('Generation details', '生成详情');
  button.setAttribute('aria-label', button.title);
  button.innerHTML = `
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M12 11v6"></path>
      <path d="M12 7h.01"></path>
    </svg>
  `;
  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    button.addEventListener(eventName, (event) => event.stopPropagation());
  });
  button.addEventListener('click', () => showGeneratedMediaDetails(file, element));
  element.appendChild(button);
  return button;
}

function closeGeneratedMediaDetails(immediate = false) {
  document.querySelectorAll('.generated-media-detail-overlay').forEach((overlay) => {
    overlay.removeAttribute('id');
    overlay.classList.remove('is-visible');
    overlay.style.pointerEvents = 'none';
    if (immediate === true) {
      overlay.remove();
    } else if (!overlay.dataset.isClosing) {
      overlay.dataset.isClosing = 'true';
      window.setTimeout(() => overlay.remove(), 180);
    }
  });
  if (generatedMediaDetailKeyHandler) {
    document.removeEventListener('keydown', generatedMediaDetailKeyHandler);
    generatedMediaDetailKeyHandler = null;
  }
}

function formatBoardAspectRatio(file, generation) {
  const recorded = String(generation && generation.aspectRatio || '').trim();
  if (recorded && recorded !== 'auto') return recorded;
  const width = Number(file && file.sourceWidth);
  const height = Number(file && file.sourceHeight);
  if (!(width > 0 && height > 0)) return '';
  const ratio = width / height;
  const commonRatios = [
    ['1:1', 1], ['5:4', 5 / 4], ['4:3', 4 / 3], ['3:2', 3 / 2],
    ['16:10', 16 / 10], ['16:9', 16 / 9], ['21:9', 21 / 9],
    ['4:5', 4 / 5], ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16]
  ];
  const nearest = commonRatios.reduce((best, entry) => (
    Math.abs(entry[1] - ratio) < Math.abs(best[1] - ratio) ? entry : best
  ));
  if (Math.abs(nearest[1] - ratio) / ratio < 0.015) return nearest[0];
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

function boardGenerationModelLabel(generation) {
  const model = String(generation && generation.modelName || '').trim();
  const provider = String(
    generation && (generation.providerName || generation.providerId) || ''
  ).trim();
  const safeProvider = /quick\s*router/i.test(provider) ? '' : provider;
  if (model && safeProvider && safeProvider !== model) return `${model} · ${safeProvider}`;
  return model || safeProvider;
}

function showGeneratedMediaDetails(file, anchorElement) {
  closeGeneratedMediaDetails(true);
  const generation = file.aiGeneration || {};
  const prompt = String(generation.prompt || '').trim();
  const referenceIds = Array.isArray(generation.referenceFileIds)
    ? generation.referenceFileIds
    : [];
  const references = referenceIds
    .map((id) => AppState.files.find((entry) => entry.id === id))
    .filter(Boolean);
  const referenceCount = Math.max(
    referenceIds.length,
    references.length,
    Number(generation.referenceCount) || 0
  );
  const hasDimensions = Number(file.sourceWidth) > 0 && Number(file.sourceHeight) > 0;
  const dimensions = hasDimensions
    ? `${Math.round(file.sourceWidth)} x ${Math.round(file.sourceHeight)}`
    : '';
  const aspectRatio = formatBoardAspectRatio(file, generation);
  const modelLabel = boardGenerationModelLabel(generation);
  const isGenerated = !!(file.aiGeneration || file.sourceFolder === 'AI Generated');

  const overlay = document.createElement('div');
  overlay.id = 'generated-media-detail-overlay';
  overlay.className = 'generated-media-detail-overlay';
  overlay.innerHTML = `
    <section class="generated-media-detail-panel" role="dialog" aria-modal="true">
      <header class="generated-media-detail-header">
        <div>
          <strong class="generated-media-detail-type"></strong>
          <span class="generated-media-detail-dimensions"></span>
        </div>
        <div class="generated-media-detail-header-actions">
          <button type="button" class="generated-media-edit"></button>
          <button type="button" class="generated-media-detail-close" aria-label="${t('Close', '关闭')}">x</button>
        </div>
      </header>
      <div class="generated-media-detail-model"></div>
      <div class="generated-media-detail-chips"></div>
      <section class="generated-media-detail-section" data-media-section="prompt">
        <div class="generated-media-detail-section-heading">
          <strong>${t('Prompt', '提示词')}</strong>
          <button type="button" class="generated-media-prompt-copy">${t('Copy', '复制')}</button>
        </div>
        <p class="generated-media-detail-prompt"></p>
      </section>
      <section class="generated-media-detail-section" data-media-section="references">
        <div class="generated-media-detail-section-heading">
          <strong>${t('References', '参考图')}</strong>
          <span class="generated-media-reference-count"></span>
        </div>
        <div class="generated-media-reference-list"></div>
      </section>
      <footer class="generated-media-detail-footer">
        <button type="button" class="generated-media-retry">${t('Retry', '重试')}</button>
        <button type="button" class="generated-media-remix">${t('Remix', '再创作')}</button>
      </footer>
    </section>
  `;

  overlay.querySelector('.generated-media-detail-type').textContent =
    generation.kind === 'video' ? t('VIDEO', '视频') : t('IMAGE', '图片');
  const dimensionsElement = overlay.querySelector('.generated-media-detail-dimensions');
  dimensionsElement.textContent = dimensions ? ` · ${dimensions}` : '';
  dimensionsElement.hidden = !dimensions;
  const modelElement = overlay.querySelector('.generated-media-detail-model');
  modelElement.textContent = modelLabel ? `${t('Model', '模型')} · ${modelLabel}` : '';
  modelElement.hidden = !modelLabel;
  const editButton = overlay.querySelector('.generated-media-edit');
  editButton.textContent = t('Edit image', '编辑图片');
  editButton.hidden = !isGenerated || !prompt || generation.kind === 'video';
  const promptSection = overlay.querySelector('[data-media-section="prompt"]');
  promptSection.hidden = !prompt;
  overlay.querySelector('.generated-media-detail-prompt').textContent = prompt;
  const referenceSection = overlay.querySelector('[data-media-section="references"]');
  referenceSection.hidden = !referenceCount;
  overlay.querySelector('.generated-media-reference-count').textContent =
    String(referenceCount).padStart(2, '0');

  const chips = overlay.querySelector('.generated-media-detail-chips');
  if (aspectRatio) {
    const aspect = document.createElement('span');
    aspect.textContent = `${t('Aspect', '比例')} ${aspectRatio}`;
    chips.appendChild(aspect);
  }
  if (generation.size) {
    const size = document.createElement('span');
    size.textContent = `${t('Quality', '画质')} ${generation.size}`;
    chips.appendChild(size);
  }
  if (Number.isFinite(Number(file.sizeBytes)) && Number(file.sizeBytes) >= 0) {
    const fileSize = document.createElement('span');
    fileSize.textContent = `${t('File', '大小')} ${formatBoardFileSize(file)}`;
    chips.appendChild(fileSize);
  }
  if (generation.kind === 'video' && generation.duration) {
    const duration = document.createElement('span');
    duration.textContent = `${t('Duration', '时长')} ${generation.duration}s`;
    chips.appendChild(duration);
  }
  chips.hidden = !chips.childElementCount;

  const referenceList = overlay.querySelector('.generated-media-reference-list');
  references.forEach((reference) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'generated-media-reference-thumb';
    button.title = reference.name;
    const image = document.createElement('img');
    image.src = reference.thumbUrl || reference.url;
    image.alt = reference.name;
    button.appendChild(image);
    button.addEventListener('click', () => {
      closeGeneratedMediaDetails();
      selectFileForPreview(reference.id);
    });
    referenceList.appendChild(button);
  });
  if (referenceCount > references.length) {
    const missing = document.createElement('span');
    missing.className = 'generated-media-reference-missing';
    missing.textContent = `+${referenceCount - references.length}`;
    referenceList.appendChild(missing);
  }
  overlay.querySelector('.generated-media-detail-close').addEventListener('click', closeGeneratedMediaDetails);
  overlay.querySelector('.generated-media-prompt-copy').disabled = !prompt;
  overlay.querySelector('.generated-media-prompt-copy').addEventListener('click', async () => {
    if (!prompt) return;
    await copyGeneratedPrompt(prompt);
    showToast(t('Prompt copied', '提示词已复制'), 'AI');
  });

  const retry = overlay.querySelector('.generated-media-retry');
  const remix = overlay.querySelector('.generated-media-remix');
  overlay.querySelector('.generated-media-detail-footer').hidden = !isGenerated || !prompt;
  retry.disabled = !prompt;
  remix.disabled = !prompt;
  retry.addEventListener('click', async () => {
    closeGeneratedMediaDetails();
    if (typeof retryGeneratedMediaFromDetails === 'function') {
      await retryGeneratedMediaFromDetails(file);
    }
  });
  remix.addEventListener('click', async () => {
    closeGeneratedMediaDetails();
    if (typeof remixGeneratedMediaFromDetails === 'function') {
      await remixGeneratedMediaFromDetails(file, false);
    }
  });
  overlay.querySelector('.generated-media-edit').addEventListener('click', async () => {
    closeGeneratedMediaDetails();
    if (typeof remixGeneratedMediaFromDetails === 'function') {
      await remixGeneratedMediaFromDetails(file, true);
    }
  });
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeGeneratedMediaDetails();
  });

  document.body.appendChild(overlay);
  overlay.querySelector('.generated-media-detail-panel').setAttribute(
    'aria-label',
    `${t('Image details', '图片详情')}: ${file.name || t('Image', '图片')}`
  );
  positionGeneratedMediaDetailsPanel(overlay, anchorElement);
  generatedMediaDetailKeyHandler = (event) => {
    if (event.key === 'Escape') closeGeneratedMediaDetails();
  };
  document.addEventListener('keydown', generatedMediaDetailKeyHandler);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

function positionGeneratedMediaDetailsPanel(overlay, anchorElement) {
  const panel = overlay.querySelector('.generated-media-detail-panel');
  if (!panel || !anchorElement) return;
  const anchor = anchorElement.getBoundingClientRect();
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const margin = 18;
  const gap = 14;
  let left;
  if (anchor.right + gap + panelWidth <= window.innerWidth - margin) {
    left = anchor.right + gap;
  } else if (anchor.left - gap - panelWidth >= margin) {
    left = anchor.left - gap - panelWidth;
  } else {
    left = Math.max(margin, (window.innerWidth - panelWidth) / 2);
  }
  const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
  const top = Math.max(margin, Math.min(anchor.top, maxTop));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

async function copyGeneratedPrompt(prompt) {
  try {
    await navigator.clipboard.writeText(prompt);
    return;
  } catch (err) {}
  const input = document.createElement('textarea');
  input.value = prompt;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}
