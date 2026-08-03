'use strict';

class AiGatewayClient {
  constructor(options) {
    this.fetch = options.fetchImpl;
    this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
    this.getAccessToken = options.getAccessToken;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async request(pathname, options = {}) {
    if (!this.isConfigured()) {
      const error = new Error('The secure AI gateway is not configured in this build.');
      error.code = 'gateway-not-configured';
      throw error;
    }
    const token = await this.getAccessToken();
    const response = await this.fetch(`${this.baseUrl}${pathname}`, {
      method: options.method || 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: options.binary ? 'application/octet-stream' : 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal
    });
    if (!response.ok) {
      let payload = {};
      try { payload = JSON.parse(await response.text()); } catch (error) {}
      const err = new Error(String(payload.message || payload.error || `Gateway request failed (HTTP ${response.status})`));
      err.code = String(payload.code || (response.status === 401 ? 'auth-required' : 'gateway-request-failed'));
      err.status = response.status;
      throw err;
    }
    if (options.binary) return Buffer.from(await response.arrayBuffer());
    return response.json();
  }

  generateMedia(kind, request, signal) {
    return this.request(`/v1/media/${kind === 'video' ? 'video' : 'image'}`, {
      body: request,
      binary: true,
      signal
    });
  }

  async chat(request, signal) {
    const payload = await this.request('/v1/chat', { body: request, signal });
    return String(payload.text || '');
  }

  discoverModels(providerId, signal) {
    return this.request(`/v1/models?providerId=${encodeURIComponent(providerId || '')}`, {
      method: 'GET',
      signal
    });
  }

  getConfig(signal) {
    return this.request('/v1/config', { method: 'GET', signal });
  }
}

module.exports = { AiGatewayClient };
