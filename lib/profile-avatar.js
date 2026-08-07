'use strict';

const crypto = require('crypto');
const path = require('path');

const AVATAR_FILENAME = 'avatar.webp';

function authenticatedUserId(session) {
  if (!session || session.authenticated !== true || !session.user) return null;
  if (typeof session.user.id !== 'string') return null;
  const userId = session.user.id.trim();
  return userId || null;
}

function profileAvatarPath(libraryRootDir, session) {
  const userId = authenticatedUserId(session);
  if (!userId) return null;

  if (typeof libraryRootDir !== 'string' || !libraryRootDir.trim()) {
    throw new TypeError('Profile avatar storage root is required.');
  }
  if (!path.isAbsolute(libraryRootDir)) {
    throw new TypeError('Profile avatar storage root must be absolute.');
  }

  const accountsDir = path.resolve(libraryRootDir, 'profile', 'accounts');
  const accountHash = crypto.createHash('sha256').update(userId, 'utf8').digest('hex');
  const avatarPath = path.join(accountsDir, accountHash, AVATAR_FILENAME);
  const relative = path.relative(accountsDir, avatarPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Profile avatar path escaped its storage directory.');
  }
  return avatarPath;
}

module.exports = {
  AVATAR_FILENAME,
  authenticatedUserId,
  profileAvatarPath
};
