'use strict';

const fs = require('fs');

function parseResponseError(payload, status) {
  const message = payload && (payload.msg || payload.message || payload.error_description || payload.error);
  const error = new Error(String(message || `Authentication failed (HTTP ${status})`));
  error.code = status === 401 ? 'invalid-login' : 'auth-failed';
  error.status = status;
  return error;
}

function tokenExpiresAt(accessToken, fallbackSeconds = 3600) {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1], 'base64url').toString('utf8'));
    if (Number(payload.exp)) return Number(payload.exp) * 1000;
  } catch (error) {}
  return Date.now() + fallbackSeconds * 1000;
}

class SupabaseAuth {
  constructor(options) {
    this.fetch = options.fetchImpl;
    this.safeStorage = options.safeStorage;
    this.sessionPath = options.sessionPath;
    this.supabaseUrl = String(options.supabaseUrl || '').replace(/\/$/, '');
    this.publishableKey = String(options.publishableKey || '').trim();
    this.session = null;
    this.refreshPromise = null;
    this._load();
  }

  isConfigured() {
    return Boolean(this.supabaseUrl && this.publishableKey);
  }

  _load() {
    if (!this.isConfigured() || !this.safeStorage || !this.safeStorage.isEncryptionAvailable()) return;
    try {
      const encrypted = fs.readFileSync(this.sessionPath);
      this.session = JSON.parse(this.safeStorage.decryptString(encrypted));
    } catch (error) {
      this.session = null;
    }
  }

  _save() {
    if (!this.session) {
      try { fs.rmSync(this.sessionPath, { force: true }); } catch (error) {}
      return;
    }
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) return;
    const encrypted = this.safeStorage.encryptString(JSON.stringify(this.session));
    const temporary = `${this.sessionPath}.tmp`;
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
    fs.renameSync(temporary, this.sessionPath);
  }

  _publicSession() {
    const user = this.session && this.session.user;
    return {
      configured: this.isConfigured(),
      authenticated: Boolean(this.session && this.session.accessToken && user),
      user: user ? { id: user.id || null, email: user.email || null } : null
    };
  }

  getPublicSession() {
    return this._publicSession();
  }

  async _request(pathname, body, accessToken) {
    if (!this.isConfigured()) {
      const error = new Error('Supabase cloud authentication is not configured in this build.');
      error.code = 'cloud-not-configured';
      throw error;
    }
    const response = await this.fetch(`${this.supabaseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        apikey: this.publishableKey,
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(body || {})
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (error) {}
    if (!response.ok) throw parseResponseError(payload, response.status);
    return payload;
  }

  _accept(payload) {
    const accessToken = payload.access_token;
    const refreshToken = payload.refresh_token;
    if (!accessToken || !refreshToken) throw parseResponseError(payload, 401);
    this.session = {
      accessToken,
      refreshToken,
      expiresAt: tokenExpiresAt(accessToken, payload.expires_in),
      user: payload.user || null
    };
    this._save();
    return this._publicSession();
  }

  async signIn(email, password) {
    const payload = await this._request('/auth/v1/token?grant_type=password', {
      email: String(email || '').trim(),
      password: String(password || '')
    });
    return this._accept(payload);
  }

  async signUp(email, password) {
    const payload = await this._request('/auth/v1/signup', {
      email: String(email || '').trim(),
      password: String(password || '')
    });
    if (payload.access_token) return this._accept(payload);
    return { ...this._publicSession(), confirmationRequired: true };
  }

  async signOut() {
    const token = this.session && this.session.accessToken;
    if (token) {
      try { await this._request('/auth/v1/logout', {}, token); } catch (error) {}
    }
    this.session = null;
    this._save();
    return this._publicSession();
  }

  async refresh() {
    if (!this.session || !this.session.refreshToken) return null;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this._request('/auth/v1/token?grant_type=refresh_token', {
      refresh_token: this.session.refreshToken
    }).then((payload) => {
      this._accept(payload);
      return this.session.accessToken;
    }).catch((error) => {
      this.session = null;
      this._save();
      throw error;
    }).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async getAccessToken() {
    if (!this.session || !this.session.accessToken) {
      const error = new Error('Sign in to your Messs account before using cloud AI.');
      error.code = 'auth-required';
      throw error;
    }
    if (Number(this.session.expiresAt) - Date.now() < 90_000) return this.refresh();
    return this.session.accessToken;
  }
}

module.exports = { SupabaseAuth, tokenExpiresAt };
