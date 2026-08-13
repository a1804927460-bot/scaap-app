'use strict';

const {
  PROVIDER_CATALOG_VERSION,
  catalogProvider
} = require('./provider-catalog');

function neutralProviderName(value, fallback = 'AI Model') {
  const cleaned = String(value || '')
    .replace(/quick\s*router/gi, 'AI')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function normalizeGatewayCatalog(remote, gatewayEndpoint) {
  const catalogVersion = Number(remote && remote.catalogVersion) || 0;
  const source = Array.isArray(remote && remote.providers) ? remote.providers : [];
  const providers = source
    .map((provider) => {
      if (!provider || !['chat', 'image', 'video'].includes(provider.kind)) return null;
      const id = String(provider.id || '').trim().slice(0, 64);
      if (!id) return null;
      const canonical = catalogProvider(id);
      const sameKind = canonical && canonical.kind === provider.kind ? canonical : null;
      if (sameKind && sameKind.hidden === true) return null;
      return {
        id,
        kind: provider.kind,
        name: sameKind
          ? sameKind.name
          : neutralProviderName(provider.name || id),
        endpoint: String(gatewayEndpoint || '').trim(),
        models: sameKind && Array.isArray(sameKind.models)
          ? sameKind.models.slice(0, 30)
          : Array.isArray(provider.models)
            ? provider.models.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 30)
            : [],
        capabilities: sameKind && sameKind.capabilities
          ? sameKind.capabilities
          : provider.capabilities && typeof provider.capabilities === 'object'
            ? provider.capabilities
            : null,
        protocol: String(sameKind && sameKind.protocol || provider.protocol || '').slice(0, 40),
        cloudManaged: true
      };
    })
    .filter(Boolean);
  return {
    catalogVersion,
    compatible: catalogVersion >= PROVIDER_CATALOG_VERSION,
    providers
  };
}

function assertGatewayProvider(catalog, kind, providerId) {
  if (!catalog || catalog.compatible !== true) {
    const error = new Error('AI 服务正在同步最新模型，请稍后重试。');
    error.code = 'gateway-catalog-outdated';
    throw error;
  }
  const normalizedKind = kind === 'video' ? 'video' : kind === 'chat' ? 'chat' : 'image';
  const requestedId = String(providerId || '').trim();
  const provider = catalog.providers.find((entry) => (
    entry.kind === normalizedKind && entry.id === requestedId
  ));
  if (!provider) {
    const error = new Error('所选 AI 模型尚未在服务端启用，请稍后重试。');
    error.code = 'provider-not-configured';
    throw error;
  }
  return provider;
}

module.exports = {
  neutralProviderName,
  normalizeGatewayCatalog,
  assertGatewayProvider
};
