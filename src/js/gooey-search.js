// Native-DOM adaptation of Aceternity UI's Gooey Input by Manu Arora.
// https://ui.aceternity.com/components/gooey-input
(() => {
  const selectors = '.canvas-library-search, .market-search, .workshop-search';
  document.querySelectorAll(selectors).forEach((root, index) => {
    const input = root.querySelector('input');
    if (!input || root.classList.contains('gooey-search')) return;
    root.classList.add('gooey-search');
    const filterId = `messs-gooey-search-${index}`;
    const surface = document.createElement('span');
    surface.className = 'gooey-search-surfaces';
    surface.setAttribute('aria-hidden', 'true');
    surface.innerHTML = `<svg width="0" height="0"><defs><filter id="${filterId}" x="-20%" y="-70%" width="140%" height="240%"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -10" result="goo"/><feComposite in="SourceGraphic" in2="goo" operator="atop"/></filter></defs></svg><span class="gooey-search-pill"></span><span class="gooey-search-bubble"></span>`;
    surface.style.setProperty('--gooey-filter', `url(#${filterId})`);
    root.prepend(surface);
    input.setAttribute('aria-label', input.placeholder);
    input.setAttribute('enterkeyhint', 'search');
    const sync = () => root.classList.toggle('is-expanded', root.contains(document.activeElement) || !!input.value);
    root.addEventListener('focusin', sync);
    root.addEventListener('focusout', () => queueMicrotask(sync));
    input.addEventListener('input', sync);
    input.addEventListener('search', sync);
    root.addEventListener('click', (event) => {
      if (!event.target.closest('button')) input.focus();
      sync();
    });
    sync();
  });
})();
