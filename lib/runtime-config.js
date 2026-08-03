'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_SUPABASE_HOST = 'trmbhcniijedpmohkbzx.supabase.co';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {};
  }
}

function normalizeHttpsUrl(value, options = {}) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  try {
    const url = new URL(text);
    const localhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(options.allowLocalhost && localhost && url.protocol === 'http:')) {
      return '';
    }
    if (url.username || url.password) return '';
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    return '';
  }
}

function loadRuntimeConfig(projectDir, options = {}) {
  const fileConfig = readJson(path.join(projectDir, 'config', 'runtime.json'));
  const allowLocalhost = !options.packaged;
  const supabaseUrl = normalizeHttpsUrl(
    process.env.MESSS_SUPABASE_URL || fileConfig.supabaseUrl,
    { allowLocalhost }
  );
  const gatewayUrl = normalizeHttpsUrl(
    process.env.MESSS_AI_GATEWAY_URL || fileConfig.aiGatewayUrl,
    { allowLocalhost }
  );
  const publishableKey = String(
    process.env.MESSS_SUPABASE_PUBLISHABLE_KEY || fileConfig.supabasePublishableKey || ''
  ).trim();
  const githubOwner = String(process.env.MESSS_GITHUB_OWNER || fileConfig.githubOwner || '').trim();
  const githubRepo = String(process.env.MESSS_GITHUB_REPO || fileConfig.githubRepo || '').trim();
  const supabaseHostValid = (() => {
    if (!supabaseUrl) return false;
    try {
      const host = new URL(supabaseUrl).hostname.toLowerCase();
      return host === EXPECTED_SUPABASE_HOST || (!options.packaged && ['localhost', '127.0.0.1'].includes(host));
    } catch (error) {
      return false;
    }
  })();

  return Object.freeze({
    supabaseUrl: supabaseHostValid ? supabaseUrl : '',
    supabasePublishableKey: publishableKey,
    aiGatewayUrl: gatewayUrl,
    githubOwner: /^[A-Za-z0-9_.-]{1,100}$/.test(githubOwner) ? githubOwner : '',
    githubRepo: /^[A-Za-z0-9_.-]{1,100}$/.test(githubRepo) ? githubRepo : '',
    gatewayConfigured: Boolean(supabaseHostValid && publishableKey && gatewayUrl),
    allowDirectAi: !options.packaged && process.env.MESSS_ALLOW_DIRECT_AI === '1'
  });
}

module.exports = { EXPECTED_SUPABASE_HOST, loadRuntimeConfig, normalizeHttpsUrl };
