'use strict';

const catalog = require('../config/provider-catalog.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function providerCatalog(kind) {
  const providers = Array.isArray(catalog.providers) ? catalog.providers : [];
  return clone(kind ? providers.filter((provider) => provider.kind === kind) : providers);
}

function catalogProvider(id) {
  return providerCatalog().find((provider) => provider.id === id) || null;
}

function canonicalProviderCapabilities(kind, id, current) {
  const existing = current && typeof current === 'object' ? current : null;
  const canonical = catalogProvider(id);
  if (!canonical || canonical.kind !== kind || !canonical.capabilities) return existing;
  // Logical Seedance slots are routed through multiple upstreams. Their
  // mode matrix must come from the bundled catalog even when an older local
  // settings file still contains a partial matrix.
  if (kind === 'video' && (id === 'video-2' || id === 'video-3')) {
    return clone(canonical.capabilities);
  }
  return existing || clone(canonical.capabilities);
}

module.exports = {
  PROVIDER_CATALOG_VERSION: Number(catalog.version) || 1,
  providerCatalog,
  catalogProvider,
  canonicalProviderCapabilities
};
