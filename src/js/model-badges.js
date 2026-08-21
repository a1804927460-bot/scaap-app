'use strict';

function aiModelBadgeKind(provider = {}) {
  const id = String(provider.id || '').trim().toLowerCase();
  const name = String(provider.name || provider.model || '').trim();
  if (id === 'image-1' || /^nano\s+banana\s+pro$/i.test(name)) return 'banana-pro';
  if (provider.icon === 'chaser-pro' || id === 'image-3' || /^chaser\s+pro$/i.test(name)) return 'chaser-pro';
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
  if (kind === 'chaser-pro') {
    const icon = document.createElement('img');
    icon.src = 'assets/model-icons/chaser-pro.png';
    icon.alt = '';
    badge.appendChild(icon);
  }
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
