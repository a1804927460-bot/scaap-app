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
  reduced.addEventListener('change', () => {
    if (reduced.matches) for (const element of running.keys()) stop(element);
  });
  return { enter, stop };
})();
