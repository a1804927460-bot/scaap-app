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

module.exports = {
  PROVIDER_CATALOG_VERSION: Number(catalog.version) || 1,
  providerCatalog,
  catalogProvider
};
