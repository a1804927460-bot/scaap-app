'use strict';

// Per-output allocations for infrastructure costs omitted from provider
// model prices. Changes must ship with a matching SQL migration so the
// desktop quote, gateway reservation, and database settlement stay identical.
const OPERATING_COST_PRICING_VERSION = '202609060001';
const DEFAULT_OPERATING_COST_CNY = Object.freeze({
  image: Object.freeze({
    gatewayRequest: 0.002,
    databaseReadWrite: 0.0015,
    objectStorage: 0.002,
    resultDownload: 0.002,
    polling: 0.0015,
    retryRecovery: 0.003,
    migrationAmortization: 0.001
  }),
  video: Object.freeze({
    gatewayRequest: 0.005,
    databaseReadWrite: 0.010,
    objectStorage: 0.040,
    resultDownload: 0.070,
    polling: 0.020,
    retryRecovery: 0.095,
    migrationAmortization: 0.010
  })
});

function operatingCostBreakdown(kind) {
  const normalizedKind = kind === 'video' ? 'video' : 'image';
  return DEFAULT_OPERATING_COST_CNY[normalizedKind];
}

function operatingCostCny(kind) {
  return Object.values(operatingCostBreakdown(kind)).reduce((total, value) => total + value, 0);
}

function publicOperatingCosts() {
  const image = operatingCostBreakdown('image');
  const video = operatingCostBreakdown('video');
  return {
    pricingVersion: OPERATING_COST_PRICING_VERSION,
    currency: 'CNY',
    image: { ...image, total: operatingCostCny('image') },
    video: { ...video, total: operatingCostCny('video') }
  };
}

module.exports = {
  OPERATING_COST_PRICING_VERSION,
  DEFAULT_OPERATING_COST_CNY,
  operatingCostBreakdown,
  operatingCostCny,
  publicOperatingCosts
};
