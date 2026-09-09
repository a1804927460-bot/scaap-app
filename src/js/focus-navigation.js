'use strict';

// Chromium may enable :focus-visible after any key. Only deliberate keyboard
// navigation should reveal focus rings on controls; never consume shortcuts.
(() => {
  const root = document.documentElement;
  root.dataset.keyboardNavigation = 'false';
  window.addEventListener('pointerdown', () => {
    root.dataset.keyboardNavigation = 'false';
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    // Run after shortcut handlers: canvas Tab opens its composer instead of
    // navigating, and must not switch the rest of the UI into focus-ring mode.
    window.setTimeout(() => {
      if (!event.defaultPrevented) root.dataset.keyboardNavigation = 'true';
    });
  }, true);
})();
