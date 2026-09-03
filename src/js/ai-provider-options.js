(function attachAiProviderOptions(global) {
  'use strict';

  const CHAT_MODEL_NAMES = {
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'kimi-k3': 'Kimi K3'
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

  global.MesssAiProviderOptions = {
    chatOptions,
    logicalModel,
    uniqueProviders
  };
}(typeof window !== 'undefined' ? window : globalThis));
