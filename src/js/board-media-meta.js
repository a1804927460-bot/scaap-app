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

let generatedMediaDetailKeyHandler = null;

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

function closeGeneratedMediaDetails() {
  const overlay = document.getElementById('generated-media-detail-overlay');
  if (overlay) {
    overlay.classList.remove('is-visible');
    window.setTimeout(() => overlay.remove(), 180);
  }
  if (generatedMediaDetailKeyHandler) {
    document.removeEventListener('keydown', generatedMediaDetailKeyHandler);
    generatedMediaDetailKeyHandler = null;
  }
}

function showGeneratedMediaDetails(file, anchorElement) {
  closeGeneratedMediaDetails();
  const generation = file.aiGeneration || {};
  const prompt = String(generation.prompt || '').trim();
  const references = (generation.referenceFileIds || [])
    .map((id) => AppState.files.find((entry) => entry.id === id))
    .filter(Boolean);
  const referenceCount = Math.max(references.length, Number(generation.referenceCount) || 0);
  const dimensions = Number(file.sourceWidth) > 0 && Number(file.sourceHeight) > 0
    ? `${Math.round(file.sourceWidth)} x ${Math.round(file.sourceHeight)}`
    : t('Size unavailable', '尺寸未知');

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
      <section class="generated-media-detail-section">
        <div class="generated-media-detail-section-heading">
          <strong>${t('Prompt', '提示词')}</strong>
          <button type="button" class="generated-media-prompt-copy">${t('Copy', '复制')}</button>
        </div>
        <p class="generated-media-detail-prompt"></p>
      </section>
      <section class="generated-media-detail-section">
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
  overlay.querySelector('.generated-media-detail-dimensions').textContent = ` · ${dimensions}`;
  overlay.querySelector('.generated-media-detail-model').textContent =
    generation.modelName || t('Earlier AI generation', '早期 AI 生成结果');
  overlay.querySelector('.generated-media-edit').textContent = t('Edit image', '编辑图片');
  overlay.querySelector('.generated-media-detail-prompt').textContent =
    prompt || t('Generation details were not recorded for this earlier result.', '此早期生成结果未记录提示词。');
  overlay.querySelector('.generated-media-reference-count').textContent =
    String(referenceCount).padStart(2, '0');

  const chips = overlay.querySelector('.generated-media-detail-chips');
  const aspect = document.createElement('span');
  aspect.textContent = `${t('Aspect', '比例')} ${generation.aspectRatio || 'auto'}`;
  chips.appendChild(aspect);
  if (generation.size) {
    const size = document.createElement('span');
    size.textContent = `${t('Quality', '画质')} ${generation.size}`;
    chips.appendChild(size);
  }

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
  if (!referenceCount) {
    const empty = document.createElement('span');
    empty.className = 'generated-media-reference-empty';
    empty.textContent = t('No reference image', '无参考图');
    referenceList.appendChild(empty);
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
