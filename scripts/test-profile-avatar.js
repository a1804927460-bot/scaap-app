'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  authenticatedUserId,
  profileAvatarPath
} = require('../lib/profile-avatar');

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'js', 'sidebar.js'), 'utf8');
const indexSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'index.html'), 'utf8');

assert.match(mainSource, /profileAvatarPath\(store\.dir, session\)/);
assert.match(mainSource, /if \(!accountUserId \|\| !avatarPath\) return \{ ok: false, reason: 'auth-required' \}/);
assert.match(sidebarSource, /accountUserId && typeof window\.messsAPI\.getProfileAvatar/);
assert.match(sidebarSource, /avatarButton\.disabled = !accountUserId/);
assert.match(sidebarSource, /async function signOutCloudAccount\(\)[\s\S]*?activeAccountAvatarUserId = null;[\s\S]*?renderAccountAvatars\('M', null\);[\s\S]*?signOutCloud\(\)/);
assert.match(indexSource, /id="account-popover-avatar"[^>]*disabled/);

const storageRoot = path.resolve(__dirname, '..', '.profile-avatar-test-root');
const signedOut = { authenticated: false, user: null };
const missingUser = { authenticated: true, user: null };
const missingUserId = { authenticated: true, user: {} };

assert.strictEqual(authenticatedUserId(null), null);
assert.strictEqual(authenticatedUserId(signedOut), null);
assert.strictEqual(authenticatedUserId(missingUser), null);
assert.strictEqual(authenticatedUserId(missingUserId), null);
assert.strictEqual(profileAvatarPath(storageRoot, signedOut), null);
assert.strictEqual(profileAvatarPath(storageRoot, missingUser), null);
assert.strictEqual(profileAvatarPath(storageRoot, missingUserId), null);

const accountA = { authenticated: true, user: { id: 'account-a' } };
const accountB = { authenticated: true, user: { id: 'account-b' } };
const accountAPath = profileAvatarPath(storageRoot, accountA);
const accountBPath = profileAvatarPath(storageRoot, accountB);

assert.strictEqual(accountAPath, profileAvatarPath(storageRoot, accountA));
assert.notStrictEqual(accountAPath, accountBPath);
assert.strictEqual(path.basename(accountAPath), 'avatar.webp');
assert.match(path.basename(path.dirname(accountAPath)), /^[a-f0-9]{64}$/);
assert.strictEqual(accountAPath.includes('account-a'), false);

const accountsDir = path.resolve(storageRoot, 'profile', 'accounts');
for (const avatarPath of [accountAPath, accountBPath]) {
  const relative = path.relative(accountsDir, avatarPath);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.strictEqual(path.dirname(path.dirname(avatarPath)), accountsDir);
}

const hostileIdPath = profileAvatarPath(storageRoot, {
  authenticated: true,
  user: { id: '../../outside-profile-directory' }
});
assert.ok(!path.relative(accountsDir, hostileIdPath).startsWith('..'));
assert.strictEqual(path.dirname(path.dirname(hostileIdPath)), accountsDir);

assert.throws(
  () => profileAvatarPath('', accountA),
  /storage root is required/i
);
assert.throws(
  () => profileAvatarPath('relative-library-root', accountA),
  /storage root must be absolute/i
);

console.log('Profile avatar tests passed.');
