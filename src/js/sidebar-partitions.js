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
  dialog.innerHTML = '<div class="partition-wheel-stage"><button class="partition-slot slot-top" type="button" disabled aria-label="预留分区"></button><button class="partition-slot slot-right" type="button" disabled aria-label="预留分区"></button><button class="partition-slot slot-current" type="button" aria-current="true">所有文件</button><button class="partition-slot slot-left" type="button" disabled aria-label="预留分区"></button><img class="partition-wheel-logo" src="assets/logo-mark.png" alt=""></div>';
  document.body.append(dialog);
  // Use one surface per capsule; filtering duplicate surfaces blurs their edges.
  const slots = [...dialog.querySelectorAll('.partition-slot')];
  let animations = [];
  const animateWheel = (closing = false) => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const current = slots.map(slot => ({transform: getComputedStyle(slot).transform, opacity: getComputedStyle(slot).opacity}));
    animations.forEach(animation => animation.cancel());
    animations = slots.map((slot, index) => {
      const style = getComputedStyle(slot);
      const joined = `translate(${style.getPropertyValue('--join-x')}, ${style.getPropertyValue('--join-y')}) rotate(-60deg) scale(.28)`;
      const frames = closing ? [current[index], {transform:joined,opacity:0}] : [
        {transform:joined,opacity:0,offset:0},
        {transform:'translate(0, 0) rotate(-3deg) scale(1.04)',opacity:1,offset:.72},
        {transform:'translate(0, 0) rotate(0deg) scale(1)',opacity:1,offset:1}
      ];
      return slot.animate(frames, {duration:reduced ? 0 : closing ? 240 : 620,
        delay:reduced ? 0 : (closing ? 3-index : index)*35, easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});
    });
  };
  let closeTimer;
  const close = () => {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    dialog.classList.add('is-closing');
    animateWheel(true);
    closeTimer = setTimeout(() => dialog.close(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350);
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
    animateWheel();
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
    animations.forEach(animation => animation.cancel());
    animations = [];
    dialog.classList.remove('is-closing');
    brand.setAttribute('aria-expanded', 'false');
    brand.focus({ preventScroll: true });
  });
}
document.addEventListener('DOMContentLoaded', initSidebarPartitions);
