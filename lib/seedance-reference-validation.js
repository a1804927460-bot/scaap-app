'use strict';

const SEEDANCE_REFERENCE_PROFILES = Object.freeze({
  '2.0': Object.freeze({
    version: '2.0',
    minimumDuration: 2,
    maximumVideoDuration: 15,
    maximumAudioDuration: 15,
    maximumCombinedVideoDuration: 15,
    maximumCombinedAudioDuration: 15
  }),
  '2.5': Object.freeze({
    version: '2.5',
    minimumDuration: 2,
    maximumVideoDuration: 30,
    maximumAudioDuration: 30,
    maximumCombinedVideoDuration: 30,
    maximumCombinedAudioDuration: 30
  })
});

const MAX_SEEDANCE_REFERENCE_AUDIO_BYTES = 15 * 1024 * 1024;

function seedanceReferenceProfile(providerId, model = '') {
  const id = String(providerId || '').trim().toLowerCase();
  const modelName = String(model || '').trim().toLowerCase();
  if (id === 'video-2' || id.includes('seedance20') || /seedance[-_ ]?2[-_. ]?0/.test(modelName)) {
    return SEEDANCE_REFERENCE_PROFILES['2.0'];
  }
  if (id === 'video-3' || id.includes('seedance25') || /seedance[-_ ]?2[-_. ]?5/.test(modelName)) {
    return SEEDANCE_REFERENCE_PROFILES['2.5'];
  }
  return null;
}

function referenceDurationError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateSeedanceReferenceDuration(profile, mediaType, duration) {
  if (!profile) return;
  const type = mediaType === 'audio' ? 'audio' : 'video';
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw referenceDurationError(
      `reference-${type}-duration-unavailable`,
      `The reference ${type} duration could not be verified before generation.`
    );
  }
  const maximum = type === 'audio' ? profile.maximumAudioDuration : profile.maximumVideoDuration;
  // Container timestamps can differ by a few milliseconds from the visible
  // timeline, so only ignore tiny encoder rounding at the two-second floor.
  if (seconds + 0.01 < profile.minimumDuration || seconds > maximum) {
    throw referenceDurationError(
      `invalid-reference-${type}-duration`,
      `Seedance ${profile.version} reference ${type} must be between ${profile.minimumDuration} and ${maximum} seconds.`
    );
  }
}

function validateSeedanceReferenceTotals(profile, durations = {}) {
  if (!profile) return;
  const videoTotal = (Array.isArray(durations.video) ? durations.video : [])
    .reduce((total, value) => total + (Number(value) || 0), 0);
  const audioTotal = (Array.isArray(durations.audio) ? durations.audio : [])
    .reduce((total, value) => total + (Number(value) || 0), 0);
  if (videoTotal > profile.maximumCombinedVideoDuration) {
    throw referenceDurationError(
      'reference-video-duration-limit',
      `Seedance ${profile.version} reference videos may total at most ${profile.maximumCombinedVideoDuration} seconds.`
    );
  }
  if (audioTotal > profile.maximumCombinedAudioDuration) {
    throw referenceDurationError(
      'reference-audio-duration-limit',
      `Seedance ${profile.version} reference audio may total at most ${profile.maximumCombinedAudioDuration} seconds.`
    );
  }
}

module.exports = {
  MAX_SEEDANCE_REFERENCE_AUDIO_BYTES,
  SEEDANCE_REFERENCE_PROFILES,
  seedanceReferenceProfile,
  validateSeedanceReferenceDuration,
  validateSeedanceReferenceTotals
};
