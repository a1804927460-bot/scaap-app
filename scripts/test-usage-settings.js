'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeUsageSummary, fillUsageRange, smoothUsagePath, usageDecimalNumber } = require('../src/js/usage-settings');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('src', 'index.html');
const source = read('src', 'js', 'usage-settings.js');
const styles = read('src', 'styles', 'main.css');
const sidebar = read('src', 'js', 'sidebar.js');
const preload = read('preload.js');
const main = read('main.js');

const summary = normalizeUsageSummary({
  authenticated: true,
  summary: {
    account: { balance: 900, reserved: 20, availableCredits: 880, membershipTier: 'free', providerCost: 400 },
    totals: { credits: 120, generations: 3, averagePerDay: 4, providerCost: 400 },
    period: { from: '2026-07-10', to: '2026-08-08', days: 30 },
    byType: [
      { kind: 'image', credits: 80, generations: 2, requests: 2, providerCost: 100 },
      { kind: 'video', credits: 40, generations: 1, requests: 1 }
    ],
    daily: [{ date: '2026-08-08', credits: 120, generations: 3, requests: 3, providerCost: 100 }],
    byModel: [{ providerId: 'image-1', kind: 'image', credits: 80, generations: 2, requests: 2, providerCost: 100 }]
  }
});
assert.strictEqual(summary.authenticated, true);
assert.deepStrictEqual(summary.account, {
  balance: 900,
  reserved: 20,
  available: 880,
  membershipTier: 'free'
});
assert.deepStrictEqual(summary.totals, { credits: 120, generations: 3, average: 4 });
assert.strictEqual(JSON.stringify(summary).includes('providerCost'), false, 'Renderer normalization must discard supplier-cost fields.');
assert.strictEqual(normalizeUsageSummary({ authenticated: false, summary: null }).authenticated, false);

const sevenDays = fillUsageRange([{ date: '2026-08-08', credits: 12, requests: 1 }], '7');
assert.strictEqual(sevenDays.length, 7);
assert.deepStrictEqual(sevenDays[6], { date: '2026-08-08', credits: 12, requests: 1 });
assert.strictEqual(fillUsageRange(sevenDays, 'all'), sevenDays);
const trendPath = smoothUsagePath([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 2 }]);
assert.match(trendPath, /^M [\s\S]* C /);
assert.match(trendPath, /3\.00 4\.00[\s\S]*5\.00 2\.00$/, 'The trend path must pass through each rendered data point.');
assert.strictEqual(usageDecimalNumber(9.53), '9.53');

assert.strictEqual((html.match(/id="activation-settings-form"/g) || []).length, 1, 'The redemption form must remain unique.');
assert.match(html, /id="usage-settings-open"[\s\S]*id="settings-view-usage"/);
assert.match(html, /id="settings-usage-view"[\s\S]*id="usage-range-switch"[\s\S]*data-usage-range="7"[\s\S]*data-usage-range="30"[\s\S]*data-usage-range="all"/);
assert.match(html, /id="usage-balance-value"[\s\S]*id="usage-total-credits"[\s\S]*id="usage-generation-count"[\s\S]*id="usage-daily-average"/);
assert.match(html, /id="usage-trend-chart"[\s\S]*id="usage-donut"[\s\S]*id="usage-model-list"/);
assert.ok(html.indexOf('id="usage-redemption"') > html.indexOf('id="usage-dashboard"'), 'Redemption must remain outside the summary state container.');
assert.match(html, /id="settings-usage-view"[^>]*hidden/, 'The dashboard must not flash placeholder values before real data loads.');
assert.ok(html.indexOf('js/usage-settings.js') < html.indexOf('js/sidebar.js'), 'Usage settings must load before sidebar initialization.');

assert.match(source, /requestRevision[\s\S]*revision !== UsageSettings\.requestRevision/, 'Range requests need stale-response protection.');
assert.match(source, /messs:membership-updated[\s\S]*resetUsageSession\(\)/, 'Balance changes must invalidate usage cache.');
assert.match(source, /function resetUsageSession[\s\S]*requestRevision \+= 1;[\s\S]*cache\.clear\(\);[\s\S]*summary = null;/, 'Account changes must clear cached usage and invalidate in-flight requests.');
assert.match(source, /messs:ai-config-updated[\s\S]*resetUsageSession\(\)/, 'Sign-in and sign-out transitions must reset usage state.');
assert.doesNotMatch(source, /setUsageState\('error', error && error\.message/, 'Server errors must not bypass localization.');
assert.match(source, /UsageSettings\.state === 'error'[\s\S]*usageLoadErrorMessage\(UsageSettings\.errorKind\)/, 'Changing languages must re-render the current error message.');
assert.ok(source.indexOf('UsageSettings.cache.set(range') > source.indexOf('if (!summary.authenticated)'), 'Signed-out summaries must never enter the usage cache.');
assert.match(source, /사용량[\s\S]*用量/, 'Usage UI needs Korean and Chinese copy.');
assert.doesNotMatch(source, /providerCost|provider_cost/, 'Renderer source must not know supplier-cost fields.');
assert.match(sidebar, /initUsageSettings/);
assert.match(sidebar, /setSettingsView\('general'\)/);
assert.match(preload, /getUsageSummary:\s*\(range\)\s*=>\s*ipcRenderer\.invoke\('membership:getUsageSummary', range\)/);
assert.match(main, /membership:getUsageSummary[\s\S]*authenticated:\s*false[\s\S]*aiGateway\.getUsageSummary\(range\)/);

assert.match(styles, /\.ai-provider-manager\[data-settings-view="usage"\][\s\S]*width:\s*min\(1040px/);
assert.match(styles, /\.usage-settings-view\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/);
assert.match(styles, /@media \(max-width: 620px\)[\s\S]*width:\s*calc\(100vw - 20px\);[\s\S]*height:\s*calc\(100vh - 20px\);/);
assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.usage-dashboard-grid\s*\{\s*grid-template-columns:\s*1fr;/);

process.stdout.write('Usage settings tests passed.\n');
