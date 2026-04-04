/**
 * api.js — CapFlow REST API Interface
 * Centralized fetch() wrapper for all backend communication.
 * No business logic here — only HTTP calls.
 */

import { supabase } from './supabase.js';

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

// ─── Machines ────────────────────────────────────────────────────────────────

export const MachinesAPI = {
  /** GET /api/machines — Fetch all machines */
  getAll: () => request('/machines'),

  /** POST /api/machines — Create a new machine */
  create: (data) => request('/machines', { method: 'POST', body: data }),

  /** PUT /api/machines/:id — Update an existing machine */
  update: (id, data) => request(`/machines/${id}`, { method: 'PUT', body: data }),

  /** PUT /api/machines/:id/activate */
  activate: (id) => request(`/machines/${id}/activate`, { method: 'PUT' }),

  /** PUT /api/machines/:id/deactivate */
  deactivate: (id) => request(`/machines/${id}/deactivate`, { method: 'PUT' }),
};

// ─── Change History ───────────────────────────────────────────────────────────

/**
 * ChangeHistoryAPI — Read and write audit log entries via Supabase.
 *
 * Table schema (see supabase/migrations/001_create_change_history.sql):
 *   id, entity_type, entity_id, entity_name, action, changes, created_at
 */
export const ChangeHistoryAPI = {
  /**
   * Log a change event.
   * Failures are caught silently so they never block the main user action.
   *
   * @param {Object} entry
   * @param {string} entry.entity_type  - 'product' | 'machine'
   * @param {string} entry.entity_id    - Record ID
   * @param {string} entry.entity_name  - Human-readable name
   * @param {string} entry.action       - 'crear' | 'editar' | 'activar' | 'desactivar'
   * @param {Object} [entry.changes]    - { field: { before, after } }
   */
  async log(entry) {
    try {
      const { error } = await supabase
        .from('change_history')
        .insert(entry);
      if (error) console.warn('[CapFlow] Change log error:', error.message);
    } catch (err) {
      console.warn('[CapFlow] Change log failed:', err.message);
    }
  },

  /**
   * Fetch recent change history entries.
   *
   * @param {Object}  [opts]
   * @param {string}  [opts.entity_type]  - Filter by entity type
   * @param {number}  [opts.limit=100]    - Max records to return
   * @returns {Promise<Array>}
   */
  async getAll({ entity_type, limit = 100 } = {}) {
    let query = supabase
      .from('change_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (entity_type) {
      query = query.eq('entity_type', entity_type);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};
