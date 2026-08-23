// Older desktop builds exposed a generic 2K video choice. Seedance 2.5's
// current upstream catalog names that QHD-class output 1440P-ESR instead.
// Keep this alias at the transport boundary so a stale Mac setting cannot be
// rejected, while other providers continue to validate their own values.
export function normalizeVideoResolution(value, providerId, model) {
  const resolution = String(value || '').trim().toUpperCase();
  const id = String(providerId || '').trim().toLowerCase();
  const modelName = String(model || '').trim();
  const isSeedance25 = id === 'video-3' || /seedance[-_. ]?2[.-]5/i.test(modelName);
  return isSeedance25 && resolution === '2K' ? '1440P-ESR' : resolution;
}
