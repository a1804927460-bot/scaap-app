import { createRemoteJWKSet, jwtVerify } from 'jose';

const projectUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');
const expectedIssuer = `${projectUrl}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${expectedIssuer}/.well-known/jwks.json`), {
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
  timeoutDuration: 5_000
});

function bearerToken(request) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(request.headers.authorization || ''));
  return match ? match[1] : '';
}

async function verifyViaAuthServer(token) {
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!publishableKey || process.env.ALLOW_AUTH_USER_FALLBACK !== 'true') return null;
  const response = await fetch(`${projectUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && user.id ? { sub: user.id, email: user.email || null, role: 'authenticated' } : null;
}

export async function authenticate(request) {
  const token = bearerToken(request);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: expectedIssuer,
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256']
    });
    if (!payload.sub || payload.role !== 'authenticated') return null;
    return { id: payload.sub, email: payload.email || null, role: payload.role };
  } catch (error) {
    try {
      const fallback = await verifyViaAuthServer(token);
      return fallback ? { id: fallback.sub, email: fallback.email, role: fallback.role } : null;
    } catch (fallbackError) {
      return null;
    }
  }
}
