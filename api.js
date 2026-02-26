/**
 * api.js — CapFlow REST API Interface
 * Centralized fetch() wrapper for all backend communication.
 * No business logic here — only HTTP calls.
 */

const API_BASE = '/api';

/**
 * Core request handler.
 * @param {string} endpoint - API path (e.g. '/products')
 * @param {Object} options  - fetch options (method, body, etc.)
 * @returns {Promise<any>}
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {}),
    },
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);

  // Handle non-2xx responses
  if (!response.ok) {
    let errorMessage = `Error ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (_) { /* ignore parse errors */ }
    throw new Error(errorMessage);
  }

  // Return parsed JSON or null for 204 No Content
  if (response.status === 204) return null;
  return response.json();
}

// ─── Products ────────────────────────────────────────────────────────────────

export const ProductsAPI = {
  /** GET /api/products — Fetch all products */
  getAll: () => request('/products'),

  /** POST /api/products — Create a new product */
  create: (data) => request('/products', { method: 'POST', body: data }),

  /** PUT /api/products/:id — Update an existing product */
  update: (id, data) => request(`/products/${id}`, { method: 'PUT', body: data }),

  /** PUT /api/products/:id/status — Toggle active/inactive */
  setStatus: (id, active) => request(`/products/${id}/status`, {
    method: 'PUT',
    body: { active },
  }),
};
