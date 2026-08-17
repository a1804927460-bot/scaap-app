'use strict';

const fs = require('fs');
const path = require('path');

const COLOR_PROFILES = Object.freeze(['auto', 'srgb', 'display-p3']);
const COLOR_PROFILE_SWITCHES = Object.freeze({
  srgb: 'srgb',
  'display-p3': 'display-p3-d65'
});
const COLOR_PROFILE_BOOTSTRAP_FILE = 'color-profile.json';

function normalizeColorProfile(profile) {
  const normalized = String(profile || '').trim().toLowerCase();
  return COLOR_PROFILES.includes(normalized) ? normalized : 'auto';
}

function chromiumColorProfile(profile) {
  return COLOR_PROFILE_SWITCHES[normalizeColorProfile(profile)] || null;
}

function colorProfileBootstrapPath(userDataDir) {
  return path.join(userDataDir, COLOR_PROFILE_BOOTSTRAP_FILE);
}

function readColorProfileBootstrap(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const profile = normalizeColorProfile(parsed && parsed.colorProfile);
    const valid = !!parsed && COLOR_PROFILES.includes(parsed.colorProfile);
    return { profile: valid ? profile : 'auto', valid };
  } catch (error) {
    return { profile: 'auto', valid: false };
  }
}

function writeColorProfileBootstrapSync(filePath, profile) {
  const normalized = normalizeColorProfile(profile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ colorProfile: normalized }, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
  return normalized;
}

async function writeColorProfileBootstrap(filePath, profile) {
  const normalized = normalizeColorProfile(profile);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify({ colorProfile: normalized }, null, 2), 'utf8');
  await fs.promises.rename(tmpPath, filePath);
  return normalized;
}

module.exports = {
  COLOR_PROFILES,
  COLOR_PROFILE_BOOTSTRAP_FILE,
  normalizeColorProfile,
  chromiumColorProfile,
  colorProfileBootstrapPath,
  readColorProfileBootstrap,
  writeColorProfileBootstrap,
  writeColorProfileBootstrapSync
};
