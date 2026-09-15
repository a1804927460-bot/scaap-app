'use strict';
window.MesssUiMotion = (() => {
  const running = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function stop(element) {
    const animation = running.get(element);
    if (!animation) return;
    animation.cancel();
    running.delete(element);
  }
  function enter(element) {
    stop(element);
    if (reduced.matches || !element?.isConnected || !window.MesssMotionRuntime) return;
    const animation = MesssMotionRuntime.animate(element,
      { opacity: [0, 1], transform: ['translateY(5px)', 'translateY(0px)'] },
      { duration: .16, ease: [0.2, 0.8, 0.2, 1] });
    running.set(element, animation);
    animation.then(() => { if (running.get(element) === animation) stop(element); });
  }
  function canvasModeSwitch(control, viewport, mode, withFeedback = true) {
    if (!control || !viewport) return;
    const thumb = control.querySelector('.board-performance-thumb');
    const performance = mode === 'performance';
    const targetX = performance ? 70 : 0;
    if (thumb) {
      stop(thumb);
      if (reduced.matches || !window.MesssMotionRuntime || !withFeedback) {
        thumb.style.transform = `translateX(${targetX}px)`;
      } else {
        const animation = MesssMotionRuntime.animate(
          thumb,
          { transform: `translateX(${targetX}px)` },
          { type: MesssMotionRuntime.spring, stiffness: 430, damping: 23, mass: .62 }
        );
        running.set(thumb, animation);
        animation.then(() => { if (running.get(thumb) === animation) running.delete(thumb); });
      }
    }
    if (!withFeedback || reduced.matches || !window.MesssMotionRuntime) return;

    const controlRect = control.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const originX = controlRect.left + controlRect.width / 2 - viewportRect.left;
    // Anchor the wave at the lower edge of the fixed mode switch so the
    // canvas reacts upward from the control instead of radiating from its
    // center and spilling the feedback toward the toolbar.
    const originY = controlRect.bottom - viewportRect.top + 2;
    const farthestX = Math.max(originX, viewportRect.width - originX);
    const farthestY = Math.max(originY, viewportRect.height - originY);
    const finalDiameter = Math.max(750, Math.hypot(farthestX, farthestY) * 2);
    viewport.querySelector('.board-mode-wave-layer')?.remove();
    const layer = document.createElement('div');
    layer.className = `board-mode-wave-layer is-${mode}`;
    layer.setAttribute('aria-hidden', 'true');
    viewport.append(layer);

    const ringAnimations = [];
    for (let index = 0; index < 4; index += 1) {
      const ring = document.createElement('span');
      ring.className = 'board-mode-wave-ring';
      ring.style.left = `${originX}px`;
      ring.style.top = `${originY}px`;
      ring.style.width = `${finalDiameter}px`;
      ring.style.height = `${finalDiameter}px`;
      layer.append(ring);
      ringAnimations.push(MesssMotionRuntime.animate(
        ring,
        {
          opacity: [0, .52 - index * .07, .22, 0],
          transform: [
            'translate(-50%, -50%) scale(.025)',
            'translate(-50%, -50%) scale(.58)',
            'translate(-50%, -50%) scale(1)'
          ]
        },
        {
          duration: 1.05 + index * .12,
          delay: index * .085,
          times: [0, .2, 1],
          ease: [[.16, 1, .3, 1], [.22, .61, .36, 1]]
        }
      ));
    }
    const surfaces = viewport.querySelectorAll('.board-canvas, .board-leafer-canvas');
    if (surfaces.length) {
      MesssMotionRuntime.animate(
        surfaces,
        {
          transform: ['scale(1)', 'scale(1.012)', 'scale(.998)', 'scale(1)'],
          opacity: [1, .9, .97, 1]
        },
        { duration: .72, times: [0, .22, .62, 1], ease: [.16, 1, .3, 1] }
      );
    }
    MesssMotionRuntime.animate(
      control,
      { transform: ['scale(1)', 'scale(1.09)', 'scale(.975)', 'scale(1)'] },
      { duration: .58, times: [0, .24, .6, 1], ease: [.16, 1, .3, 1] }
    );
    Promise.all(ringAnimations.map((animation) => animation.finished || animation)).finally(() => layer.remove());
  }
  reduced.addEventListener('change', () => {
    if (reduced.matches) for (const element of running.keys()) stop(element);
  });
  return { canvasModeSwitch, enter, stop };
})();
