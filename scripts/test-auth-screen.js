'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles', 'start.css'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src', 'js', 'sidebar.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

[
  'account-auth-screen', 'account-auth-google', 'account-auth-email',
  'account-auth-password', 'account-auth-submit', 'account-auth-forgot',
  'account-auth-mode-toggle'
].forEach((id) => assert(html.includes(`id="${id}"`), `missing ${id}`));
assert.match(html, /account-auth-brand[\s\S]*?assets\/logo-mark\.png[\s\S]*?SCAAP/);
assert.match(css, /\.account-auth-screen\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?place-items:\s*center;/);
assert.match(css, /body\.is-auth-required \.section-tabs\s*\{\s*display:\s*none;/);
assert.match(sidebar, /function syncAccountAuthScreen[\s\S]*?session\.authenticated[\s\S]*?is-auth-required[\s\S]*?section\.inert = required/);
assert.match(sidebar, /async function submitAccountAuthScreen[\s\S]*?signUpCloud[\s\S]*?signInCloud/);
assert.match(sidebar, /async function signOutCloudAccount[\s\S]*?signOutCloud\(\)[\s\S]*?refreshAiMediaSettings/);
assert.match(sidebar, /onCloudSessionChanged[\s\S]*?syncAccountAuthScreen/);
assert.match(preload, /requestCloudPasswordReset:[\s\S]*?auth:requestPasswordReset/);
assert.match(preload, /onCloudSessionChanged:[\s\S]*?auth:sessionChanged/);
assert.match(main, /auth:requestPasswordReset[\s\S]*?requestPasswordReset/);
assert.match(main, /auth:signOut[\s\S]*?broadcastRendererEvent\('auth:sessionChanged', session\)/);

console.log('Account authentication screen tests passed.');
