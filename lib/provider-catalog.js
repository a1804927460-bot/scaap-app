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
  // Routed video slots are application-owned. Their mode matrix and Atlas
  // routing metadata must come from the bundled catalog even when an older
  // local settings file still contains a stale direct-provider config.
  if (kind === 'video' && ['video-1', 'video-2', 'video-3'].includes(id)) {
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
