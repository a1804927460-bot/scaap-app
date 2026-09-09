(function attachAiProviderOptions(global) {
  'use strict';

  const CHAT_MODEL_NAMES = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'kimi-k3': 'Kimi K3',
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'gpt-6-astra': 'GPT-6 Astra'
  };

  function clean(value) {
    return String(value || '').trim();
  }

  function normalized(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function logicalModel(provider, kind) {
    const explicit = normalized(provider && provider.logicalModel);
    if (explicit) return explicit;
    const source = [provider && provider.model, provider && provider.name, provider && provider.id]
      .map(normalized).filter(Boolean).join('-');
    if (kind === 'chat') return normalized(provider && provider.model) || source;
    if (/gpt.*image.*2/.test(source)) return 'gpt-image-2';
    if (/nano.*banana.*2.*lite/.test(source)) return 'nano-banana-2-lite';
    if (/nano.*banana.*2/.test(source)) return 'nano-banana-2';
    if (/nano.*banana.*pro/.test(source)) return 'nano-banana-pro';
    if (/minimax.*h3/.test(source)) return 'minimax-h3';
    if (/seedance.*2.*5/.test(source)) return 'seedance-2-5';
    if (/seedance.*2.*0/.test(source)) return 'seedance-2-0';
    if (/kling.*o.*3/.test(source)) return 'kling-o3';
    if (/kling.*v.*3/.test(source)) return 'kling-v3';
    return source;
  }

  function isUsable(provider) {
    return !!provider && provider.available !== false && provider.hidden !== true
      && !!clean(provider.id) && !!clean(provider.name) && !!clean(provider.endpoint);
  }

  function priority(provider, activeProviderId) {
    let score = 0;
    if (clean(provider.id) === clean(activeProviderId)) score += 100;
    if (provider.hidden !== true) score += 10;
    if (provider.cloudManaged === true) score += 1;
    return score;
  }

  function uniqueProviders(providers, kind, options = {}) {
    const selected = new Map();
    (Array.isArray(providers) ? providers : []).forEach((provider) => {
      if (!isUsable(provider)) return;
      const key = logicalModel(provider, kind);
      if (!key) return;
      const previous = selected.get(key);
      if (!previous || priority(provider, options.activeProviderId) > priority(previous, options.activeProviderId)) {
        selected.set(key, provider);
      }
    });
    return [...selected.values()];
  }

  function chatOptions(providers, options = {}) {
    const allowed = options.allowedModels instanceof Set ? options.allowedModels : null;
    const selected = new Map();
    (Array.isArray(providers) ? providers : []).forEach((provider) => {
      if (!isUsable(provider)) return;
      const models = Array.isArray(provider.models) && provider.models.length
        ? provider.models
        : [provider.model];
      models.forEach((rawModel) => {
        const model = clean(rawModel);
        const key = model.toLowerCase();
        if (!model || (allowed && !allowed.has(model))) return;
        const candidate = {
          id: `${clean(provider.id)}::${model}`,
          providerId: clean(provider.id),
          model,
          logicalModel: model,
          name: (options.names && options.names[model]) || CHAT_MODEL_NAMES[model] || model,
          endpoint: clean(provider.endpoint),
          capabilities: provider.capabilities || null
        };
        const previous = selected.get(key);
        if (!previous || priority(provider, options.activeProviderId) > priority(previous._provider)) {
          candidate._provider = provider;
          selected.set(key, candidate);
        }
      });
    });
    return [...selected.values()].map((entry) => {
      delete entry._provider;
      return entry;
    });
  }

  const CHAT_PRESETS = [
    { model: 'gemini-3.8-flash', en: 'Fast', zh: '快速', icon: 'zap' },
    { model: 'gemini-3.1-pro', en: 'Balanced', zh: '均衡', icon: 'circle-check' },
    { model: 'gpt-5.6-sol', en: 'Ultimate', zh: '极致', icon: 'gem' }
  ];

  function appendChatPresets(container, providers, selectedModel, onSelect, translate) {
    CHAT_PRESETS.forEach((preset) => {
      const provider = providers.find((entry) => entry.model === preset.model);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-chat-preset';
      button.dataset.presetModel = preset.model;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(selectedModel === preset.model));
      button.classList.toggle('is-active', selectedModel === preset.model);
      button.disabled = !provider;
      button.title = translate(preset.en, preset.zh);
      const icon = document.createElement('img');
      icon.className = 'ai-chat-preset-icon';
      icon.src = `assets/icons/lucide/${preset.icon}.svg`;
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = translate(preset.en, preset.zh);
      button.append(icon, label);
      button.addEventListener('click', () => { if (provider) onSelect(provider); });
      container.appendChild(button);
    });
    const separator = document.createElement('div');
    separator.className = 'ai-chat-preset-divider';
    separator.setAttribute('role', 'presentation');
    container.appendChild(separator);
  }

  function syncChatPresetSelection(container, label, model, usePreset, translate) {
    const preset = usePreset && CHAT_PRESETS.find(entry => entry.model === model);
    container.querySelectorAll('[data-preset-model]').forEach(button => {
      const active = !!preset && button.dataset.presetModel === model;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (!preset) return;
    container.querySelectorAll('.ai-model-picker-option, [data-agent-chat-model]').forEach(button => {
      button.classList.remove('is-active'); button.setAttribute('aria-selected', 'false');
    });
    const icon = document.createElement('img');
    icon.className = 'ai-chat-preset-icon'; icon.src = `assets/icons/lucide/${preset.icon}.svg`; icon.alt = '';
    const text = document.createElement('span'); text.textContent = translate(preset.en, preset.zh);
    label.replaceChildren(icon, text);
  }

  global.MesssAiProviderOptions = {
    routingStrategy(model, usePreset = true) {
      // Preset buttons express a capability floor; the actual model is selected from text complexity.
      return usePreset ? 'auto' : 'auto';
    },
    chatPresets: CHAT_PRESETS.map(preset => Object.freeze({ ...preset })),
    syncChatPresetSelection,
    appendChatPresets,
    chatOptions,
    logicalModel,
    uniqueProviders
  };
}(typeof window !== 'undefined' ? window : globalThis));
