import crypto from 'node:crypto';

function providerUserSecret() {
  return String(
    process.env.PROVIDER_USER_HASH_SECRET
    || process.env.AI302_TASK_SECRET
    || process.env.SUPABASE_SECRET_KEY
    || ''
  ).trim();
}

export function providerUserId(userId, secret = providerUserSecret()) {
  const normalizedSecret = String(secret || '').trim();
  if (!normalizedSecret) {
    throw Object.assign(new Error('The provider user identity secret is not configured.'), {
      status: 503,
      code: 'provider-user-secret-missing'
    });
  }
  const digest = crypto.createHmac('sha256', normalizedSecret)
    .update(String(userId || ''))
    .digest('hex')
    .slice(0, 20);
  return `u_${digest}`;
}
