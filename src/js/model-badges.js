'use strict';

function aiModelBadgeKind(provider = {}) {
  // Model identity is text-only. Keep this compatibility helper returning no
  // badge so older callers cannot reintroduce provider-specific artwork.
  return null;
}

function appendAiModelLabel(container, provider, options = {}) {
  container.replaceChildren();
  const label = document.createElement('span');
  label.className = 'ai-model-label-text';
  label.textContent = typeof publicModelLabel === 'function'
    ? publicModelLabel(provider && (provider.name || provider.model) || '')
    : String(provider && (provider.name || provider.model) || '');
  container.appendChild(label);
}
