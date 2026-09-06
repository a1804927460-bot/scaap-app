'use strict';
function initSidebarPartitions() {
  const brand = document.getElementById('sidebar-brand-btn');
  if (!brand || brand.dataset.partitionReady) return;
  brand.dataset.partitionReady = 'true';
  brand.setAttribute('aria-haspopup', 'dialog');
  brand.setAttribute('aria-expanded', 'false');
  const dialog = document.createElement('dialog');
  dialog.className = 'sidebar-partition-wheel';
  dialog.setAttribute('aria-label', '切换分区');
  dialog.innerHTML = '<div class="partition-wheel-stage"><span class="partition-slot slot-top" aria-hidden="true"></span><span class="partition-slot slot-left" aria-hidden="true"></span><span class="partition-slot slot-right" aria-hidden="true"></span><img class="partition-wheel-logo" src="assets/logo-mark.png" alt=""><button class="partition-slot slot-current" type="button" aria-current="true">所有文件</button></div>';
  document.body.append(dialog);
  const surfaces = document.createElement('div');
  surfaces.className = 'partition-wheel-surfaces';
  surfaces.setAttribute('aria-hidden', 'true');
  surfaces.innerHTML = '<svg width="0" height="0"><defs><filter id="partition-goo" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -10"/><feComposite in="SourceGraphic" operator="atop"/></filter></defs></svg>';
  for (const direction of ['top', 'left', 'right', 'current']) {
    const surface = document.createElement('span');
    surface.className = `partition-slot slot-${direction}`;
    surfaces.append(surface);
  }
  dialog.querySelector('.partition-wheel-stage').prepend(surfaces);
  let closeTimer;
  const close = () => {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    dialog.classList.add('is-closing');
    closeTimer = setTimeout(() => dialog.close(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
  };
  let timer = null;
  let origin = null;
  let suppressClick = false;
  const cancelHold = () => { clearTimeout(timer); timer = null; origin = null; };
  const open = () => {
    cancelHold();
    if (dialog.open) return;
    const rect = brand.getBoundingClientRect();
    dialog.style.left = `${Math.max(8, Math.min(innerWidth - 312, rect.left + rect.width / 2 - 148))}px`;
    dialog.style.top = `${Math.max(8, Math.min(innerHeight - 292, rect.top))}px`;
    dialog.showModal();
    dialog.classList.remove('is-closing');
    brand.setAttribute('aria-expanded', 'true');
  };
  brand.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    suppressClick = false;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => { suppressClick = true; open(); }, 450);
  });
  document.addEventListener('pointermove', event => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) cancelHold();
  }, { passive: true });
  document.addEventListener('pointerup', cancelHold, true);
  document.addEventListener('pointercancel', cancelHold, true);
  window.addEventListener('blur', cancelHold);
  brand.addEventListener('click', event => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }, true);
  brand.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    open();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('button.slot-current')) close();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    clearTimeout(closeTimer);
    dialog.classList.remove('is-closing');
    brand.setAttribute('aria-expanded', 'false');
    brand.focus({ preventScroll: true });
  });
}
document.addEventListener('DOMContentLoaded', initSidebarPartitions);
