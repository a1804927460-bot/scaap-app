'use strict';
const { retailCreditsFromUpstreamCny, USD_TO_CNY } = require('./credit-pricing');
function falResolution(options = {}) {
  return Math.max(Number(options.width) || 0, Number(options.height) || 0) > 2048 ? '4K' : '1K';
}
function quoteFalTool(providerId, options = {}) {
  if (!['background-remove', 'clipdrop-uncrop'].includes(providerId)) throw new Error('Invalid FAL tool');
  const resolution = falResolution(options);
  const upstreamUsd = providerId === 'background-remove' ? 0.001 : (resolution === '4K' ? 0.30 : 0.15) + 0.05;
  return { resolution, upstreamUsd, credits: retailCreditsFromUpstreamCny(upstreamUsd * USD_TO_CNY + 0.013) };
}
module.exports = { falResolution, quoteFalTool };
