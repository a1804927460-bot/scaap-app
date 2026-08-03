'use strict';
/* Styled confirm dialog matching the rest of the app. */

function showConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true }) {
  return new Promise((resolve) => {
    const existing = document.getElementById('confirm-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirm-dialog-overlay';
    overlay.className = 'confirm-dialog-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog" role="alertdialog" aria-modal="true">
        <div class="confirm-dialog-icon ${danger ? 'is-danger' : ''}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div class="confirm-dialog-title">${escapeHtml(title)}</div>
        <div class="confirm-dialog-message">${escapeHtml(message)}</div>
        <div class="confirm-dialog-actions">
          <button class="pill-btn pill-btn-ghost confirm-dialog-cancel">${escapeHtml(cancelLabel)}</button>
          <button class="pill-btn ${danger ? 'pill-btn-danger' : ''} confirm-dialog-confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    function close(result) {
      overlay.classList.remove('is-visible');
      setTimeout(() => overlay.remove(), 180);
      resolve(result);
    }

    overlay.querySelector('.confirm-dialog-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.confirm-dialog-confirm').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    const onKey = (e) => {
      if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); }
      if (e.key === 'Enter') { close(true); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.confirm-dialog-confirm').focus();
  });
}
