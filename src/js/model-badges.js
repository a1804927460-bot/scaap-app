'use strict';

function aiModelBadgeKind(provider = {}) {
  const id = String(provider.id || '').trim().toLowerCase();
  const name = String(provider.name || provider.model || '').trim();
  if (id === 'image-1' || /^nano\s+banana\s+pro$/i.test(name)) return 'banana-pro';
  if (/^gpt(?:[\s-]|$)/i.test(name)) return 'gpt';
  return null;
}

function createAiModelBadge(kind) {
  const badge = document.createElement('span');
  badge.className = `ai-model-badge ai-model-badge-${kind}`;
  badge.setAttribute('aria-hidden', 'true');
  if (kind === 'banana-pro') {
    badge.textContent = '\uD83C\uDF4C';
    return badge;
  }
  badge.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3.1a4.55 4.55 0 0 1 7.9 3.1 4.55 4.55 0 0 1 .1 7.2 4.55 4.55 0 0 1-4 6.7 4.55 4.55 0 0 1-7.9-3.1A4.55 4.55 0 0 1 8 9.8 4.55 4.55 0 0 1 12 3.1Z"/>
      <path d="m8 9.8 4 2.3v4.8m8-3.5-4-2.3-4 2.3m7.9-7.2L16 8.5v4.6m0 7-4-2.3-4 2.3m.1-13.9 4 2.3 4-2.3"/>
    </svg>`;
  return badge;
}

function appendAiModelLabel(container, provider, options = {}) {
  container.replaceChildren();
  const kind = aiModelBadgeKind(provider);
  if (kind && options.icon !== false) container.appendChild(createAiModelBadge(kind));
  const label = document.createElement('span');
  label.className = 'ai-model-label-text';
  label.textContent = String(provider && (provider.name || provider.model) || '');
  container.appendChild(label);
  if (kind === 'banana-pro' && options.sparkle !== false) {
    const sparkle = document.createElement('span');
    sparkle.className = 'ai-model-pro-sparkle';
    sparkle.textContent = '\u2726';
    sparkle.setAttribute('aria-hidden', 'true');
    container.appendChild(sparkle);
  }
}
