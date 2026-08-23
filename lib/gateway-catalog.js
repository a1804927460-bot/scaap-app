'use strict';

const {
  PROVIDER_CATALOG_VERSION,
  catalogProvider
} = require('./provider-catalog');
const { sanitizePublicModelLabel } = require('./public-model-label');

function neutralProviderName(value, fallback = 'AI Model') {
  const cleaned = sanitizePublicModelLabel(value, fallback).slice(0, 80);
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
          ? neutralProviderName(sameKind.name, id)
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
  if (!catalog || !Array.isArray(catalog.providers)) {
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
    // A stale gateway catalog is a deployment lag, not a reason to take
    // every already-deployed model offline. Only the requested model should
    // be rejected when it is absent from the gateway's published catalog.
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
