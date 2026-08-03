'use strict';
/* Right-side file detail panel: shown instead of usage stats while a file
   is selected - basic metadata, an editable filename, and an export button. */

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function showFileDetailPanel(file) {
  document.getElementById('ai-assistant-panel').hidden = true;
  const panel = document.getElementById('file-detail-panel');
  panel.hidden = false;

  const nameInput = document.getElementById('file-detail-name');
  nameInput.value = file.name;
  nameInput.dataset.fileId = file.id;

  const rows = document.getElementById('file-detail-rows');
  rows.innerHTML = '';
  const entries = [
    [t('Format', '格式'), (file.ext || '').replace('.', '').toUpperCase() || t('Unknown', '未知')],
    [t('File Size', '文件大小'), formatBytes(file.sizeBytes)],
    [t('Added', '添加时间'), formatDateTime(file.importedAt)]
  ];
  for (const [label, value] of entries) {
    const row = document.createElement('div');
    row.className = 'file-detail-row';
    row.innerHTML = `<span class="file-detail-row-label">${escapeHtml(label)}</span><span class="file-detail-row-value">${escapeHtml(value)}</span>`;
    rows.appendChild(row);
  }

  document.getElementById('file-detail-export').dataset.fileId = file.id;
}

function hideFileDetailPanel() {
  document.getElementById('ai-assistant-panel').hidden = false;
  document.getElementById('file-detail-panel').hidden = true;
}

function initDetailPanel() {
  document.getElementById('file-detail-close').addEventListener('click', () => {
    clearPreview();
    hideFileDetailPanel();
  });

  const nameInput = document.getElementById('file-detail-name');
  async function commitNameChange() {
    const id = nameInput.dataset.fileId;
    const newName = nameInput.value.trim();
    const f = AppState.files.find((x) => x.id === id);
    if (!f || !newName || newName === f.name) {
      if (f) nameInput.value = f.name;
      return;
    }
    const res = await window.messsAPI.renameFile(id, newName);
    if (res.ok) {
      f.name = res.file.name;
      renderFileList(currentFileListScope());
      renderBoard();
    }
  }
  nameInput.addEventListener('blur', commitNameChange);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  document.getElementById('file-detail-export').addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.fileId;
    if (!id) return;
    const res = await window.messsAPI.exportFile(id);
    if (res.ok) showToast(t('File exported', '文件已导出'), 'OK');
  });
}
