/**
 * api.js — CapFlow Data Layer
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  PROTOTYPE PHASE — localStorage adapter is active.         │
 * │  To switch to the real REST API:                           │
 * │    1. Set USE_LOCAL_STORE = false                          │
 * │    2. Ensure your Node.js backend is running               │
 * │    3. That's it — the module interface is identical        │
 * └─────────────────────────────────────────────────────────────┘
 *
 * All adapters expose the same async interface:
 *   getAll()          → Promise<Product[]>
 *   create(data)      → Promise<Product>
 *   update(id, data)  → Promise<Product>
 *   remove(id)        → Promise<null>          ← prototype only
 *   setStatus(id, active) → Promise<Product>
 *
 * No business logic lives here — only data transport.
 */

// ─── Feature Flag ──────────────────────────────────────────────────────────────
/**
 * Toggle between the localStorage prototype layer and the real REST API.
 * Set to false when the backend is ready.
 */
const USE_LOCAL_STORE = true;

// =============================================================================
// LAYER A — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key used to persist the products array. */
const STORAGE_KEY_PRODUCTS = 'capflow_products';

/**
 * Low-level helpers for reading and writing the products array
 * from localStorage. All other store functions go through these.
 */
const _store = {
  /**
   * Read the full products array from localStorage.
   * Returns an empty array if nothing is stored yet.
   * @returns {Array}
   */
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_PRODUCTS)) || [];
    } catch {
      return [];
    }
  },

  /**
   * Persist the full products array to localStorage.
   * @param {Array} products
   */
  write(products) {
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(products));
  },

  /**
   * Generate a simple unique ID string.
   * Combines timestamp + random suffix for collision resistance.
   * @returns {string}
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * _migrateProduct — normalize a raw stored product record for external consumption.
 *
 * Applied on every read from localStorage. Non-destructive: the raw bytes in
 * storage are never modified. Callers always receive the current schema.
 *
 * Migrations:
 *   • type 'produced'  → 'manufactured'  (renamed in the v2 schema)
 *   • price fields stripped from the returned object so no caller can
 *     accidentally display or act on stale priceStandard / priceInvestor data
 *
 * @param {Object} p  Raw product record from localStorage
 * @returns {Object}  Clean record matching the current schema
 */
function _migrateProduct(p) {
  // Destructure price fields away — they are intentionally discarded
  // eslint-disable-next-line no-unused-vars
  const { priceStandard, priceInvestor, price, priceReference, ...rest } = p;
  return {
    id:              rest.id,
    name:            rest.name,
    type:            rest.type === 'produced' ? 'manufactured' : (rest.type || 'manufactured'),
    active:          rest.active !== false,
    inventoryItemId: rest.inventoryItemId || null,   // B1: link to InventoryAPI item
    createdAt:       rest.createdAt,
    updatedAt:       rest.updatedAt,
  };
}

/**
 * LocalProductsStore — localStorage adapter.
 *
 * Current schema (v2):
 *   id, name, type ('manufactured' | 'resale'), active, createdAt, updatedAt
 *
 * Price fields (priceStandard, priceInvestor) are removed from the model.
 * They are stripped on every read via _migrateProduct() so legacy localStorage
 * data is healed transparently — no migration script required.
 * New records never receive them.
 *
 * type 'produced' (v1 schema) is migrated to 'manufactured' on every read.
 *
 * Every method returns a resolved Promise so products.js is agnostic about
 * the underlying storage. Flip USE_LOCAL_STORE to swap to the REST adapter.
 */
const LocalProductsStore = {
  /**
   * Return all products from localStorage, migrated to the current schema.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_store.read().map(_migrateProduct));
  },

  /**
   * Return a single product by id, or null if not found.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  getById(id) {
    const raw = _store.read().find(p => String(p.id) === String(id));
    return Promise.resolve(raw ? _migrateProduct(raw) : null);
  },

  /**
   * Add a new product and persist it.
   * Price fields in `data` are silently ignored — the v2 schema has none.
   * `type` value 'produced' is accepted and stored as 'manufactured'.
   * Assigns id, active:true, and createdAt automatically.
   * @param {Object} data  - { name, type, active? }
   * @returns {Promise<Object>}  The newly created product
   */
  create(data) {
    const products = _store.read();

    const newProduct = {
      id:        _store.generateId(),
      name:      (data.name || '').trim(),
      type:      data.type === 'produced' ? 'manufactured' : (data.type || 'manufactured'),
      active:    data.active !== false,
      createdAt: new Date().toISOString(),
    };

    products.push(newProduct);
    _store.write(products);

    return Promise.resolve(newProduct);
  },

  /**
   * Update allowed fields on an existing product.
   * Price fields in `data` are silently ignored.
   * `id` and `createdAt` are always preserved.
   * @param {string} id
   * @param {Object} data  - { name?, type?, active? }
   * @returns {Promise<Object>}  The updated product (migrated)
   */
  update(id, data) {
    const products = _store.read();
    const index    = products.findIndex(p => String(p.id) === String(id));

    if (index === -1) {
      return Promise.reject(new Error(`Producto con id "${id}" no encontrado.`));
    }

    const prev    = products[index];
    const rawType = data.type !== undefined ? data.type : prev.type;

    const updated = {
      id:              prev.id,        // immutable
      createdAt:       prev.createdAt, // immutable
      name:            data.name   !== undefined ? (data.name || '').trim() : prev.name,
      type:            rawType === 'produced' ? 'manufactured' : (rawType || 'manufactured'),
      active:          data.active !== undefined ? Boolean(data.active) : prev.active,
      // inventoryItemId preserved from prev unless explicitly set by ensureProductInventoryItem
      inventoryItemId: data.inventoryItemId !== undefined
        ? (data.inventoryItemId || null)
        : (prev.inventoryItemId || null),
      updatedAt:       new Date().toISOString(),
    };

    products[index] = updated;
    _store.write(products);

    return Promise.resolve(_migrateProduct(updated));
  },

  /**
   * Hard-delete a product by id.
   * Prototype phase only — production will use setStatus().
   * @param {string} id
   * @returns {Promise<null>}
   */
  remove(id) {
    const products = _store.read();
    const filtered = products.filter(p => String(p.id) !== String(id));

    if (filtered.length === products.length) {
      return Promise.reject(new Error(`Producto con id "${id}" no encontrado.`));
    }

    _store.write(filtered);
    return Promise.resolve(null);
  },

  /**
   * Toggle the `active` flag on a product.
   * @param {string}  id
   * @param {boolean} active
   * @returns {Promise<Object>}  The updated product (migrated)
   */
  setStatus(id, active) {
    return LocalProductsStore.update(id, { active });
  },
};

// =============================================================================
// LAYER B — REST API Adapter (Production Phase)
// =============================================================================

const API_BASE = '/api';

/**
 * Core fetch wrapper used by all REST adapter methods.
 * Throws a descriptive Error for any non-2xx HTTP response.
 * @param {string} endpoint
 * @param {Object} options
 * @returns {Promise<any>}
 */
async function _request(endpoint, options = {}) {
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      ...(options.headers || {}),
    },
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  if (!response.ok) {
    let msg = `Error ${response.status}: ${response.statusText}`;
    try { msg = (await response.json()).message || msg; } catch (_) {}
    throw new Error(msg);
  }

  return response.status === 204 ? null : response.json();
}

/**
 * RestProductsStore — REST API adapter.
 * Identical interface to LocalProductsStore.
 */
const RestProductsStore = {
  getAll:    ()          => _request('/products'),
  getById:   (id)        => _request(`/products/${id}`),
  create:    (data)      => _request('/products',              { method: 'POST',   body: data }),
  update:    (id, data)  => _request(`/products/${id}`,        { method: 'PUT',    body: data }),
  remove:    (id)        => _request(`/products/${id}`,        { method: 'DELETE' }),
  setStatus: (id, active)=> _request(`/products/${id}/status`, { method: 'PUT',    body: { active } }),
};

// =============================================================================
// EXPORTS — Single switchable interface
// =============================================================================

/**
 * ProductsAPI is the one symbol imported by products.js.
 * Switch USE_LOCAL_STORE to change the entire data layer.
 */
export const ProductsAPI = USE_LOCAL_STORE ? LocalProductsStore : RestProductsStore;

// =============================================================================
// MACHINES — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key used to persist the machines array. */
const STORAGE_KEY_MACHINES = 'capflow_machines';

/**
 * Low-level read/write helpers scoped to the machines collection.
 * Mirrors the _store pattern used by products — fully independent.
 */
const _machineStore = {
  /** Read machines array from localStorage. Returns [] on parse failure. */
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_MACHINES)) || [];
    } catch {
      return [];
    }
  },

  /** Persist the full machines array to localStorage. */
  write(machines) {
    localStorage.setItem(STORAGE_KEY_MACHINES, JSON.stringify(machines));
  },

  /** Generate a collision-resistant unique ID (timestamp + random suffix). */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * LocalMachinesStore — localStorage adapter for machines.
 *
 * All methods return Promises so machines.js is agnostic about
 * the underlying storage. Flip USE_LOCAL_STORE to swap layers.
 */
const LocalMachinesStore = {
  /**
   * Return all machines from localStorage.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_machineStore.read());
  },

  /**
   * Create a new machine record.
   * Assigns `id`, `isActive: true`, and `createdAt` automatically.
   * @param {Object} data  - Fields from the form (name, code, notes)
   * @returns {Promise<Object>}  The persisted machine with its new id
   */
  create(data) {
    const machines = _machineStore.read();

    const newMachine = {
      ...data,
      id:        _machineStore.generateId(),
      isActive:  data.isActive !== undefined ? data.isActive : true,
      createdAt: new Date().toISOString(),
    };

    machines.push(newMachine);
    _machineStore.write(machines);

    return Promise.resolve(newMachine);
  },

  /**
   * Update an existing machine's fields.
   * `id` and `createdAt` are always preserved regardless of `data` content.
   * @param {string} id
   * @param {Object} data  - Fields to update
   * @returns {Promise<Object>}  The updated machine
   */
  update(id, data) {
    const machines = _machineStore.read();
    const index    = machines.findIndex(m => String(m.id) === String(id));

    if (index === -1) {
      return Promise.reject(new Error(`Máquina con id "${id}" no encontrada.`));
    }

    const updated = {
      ...machines[index],  // preserve existing fields (especially id, createdAt)
      ...data,             // apply incoming changes
      id:        machines[index].id,        // id is immutable
      createdAt: machines[index].createdAt, // createdAt is immutable
      updatedAt: new Date().toISOString(),
    };

    machines[index] = updated;
    _machineStore.write(machines);

    return Promise.resolve(updated);
  },

  /**
   * Deactivate a machine (set isActive = false).
   * Machines are never permanently deleted in this system.
   * @param {string} id
   * @returns {Promise<Object>}  The updated machine
   */
  deactivate(id) {
    return LocalMachinesStore.update(id, { isActive: false });
  },

  /**
   * Activate a previously deactivated machine (set isActive = true).
   * @param {string} id
   * @returns {Promise<Object>}  The updated machine
   */
  activate(id) {
    return LocalMachinesStore.update(id, { isActive: true });
  },
};

// =============================================================================
// MACHINES — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestMachinesStore — REST adapter for machines.
 * Identical interface to LocalMachinesStore for zero-friction swap.
 */
const RestMachinesStore = {
  getAll:     ()         => _request('/machines'),
  create:     (data)     => _request('/machines',              { method: 'POST',  body: data }),
  update:     (id, data) => _request(`/machines/${id}`,        { method: 'PUT',   body: data }),
  deactivate: (id)       => _request(`/machines/${id}/deactivate`, { method: 'PUT' }),
  activate:   (id)       => _request(`/machines/${id}/activate`,   { method: 'PUT' }),
};

// =============================================================================
// MACHINES EXPORT — Single switchable interface
// =============================================================================

/**
 * MachinesAPI is the one symbol imported by machines.js.
 * Controlled by the same USE_LOCAL_STORE flag as ProductsAPI.
 */
export const MachinesAPI = USE_LOCAL_STORE ? LocalMachinesStore : RestMachinesStore;

// =============================================================================
// PRODUCTION — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key used to persist production records. */
const STORAGE_KEY_PRODUCTION = 'capflow_production';

/**
 * Low-level read/write helpers scoped to the production collection.
 * Mirrors the pattern used by Products and Machines — fully independent.
 */
const _productionStore = {
  /** Read production records from localStorage. Returns [] on parse failure. */
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_PRODUCTION)) || [];
    } catch {
      return [];
    }
  },

  /** Persist the full production records array to localStorage. */
  write(records) {
    localStorage.setItem(STORAGE_KEY_PRODUCTION, JSON.stringify(records));
  },

  /** Generate a collision-resistant unique ID (timestamp + random suffix). */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * LocalProductionStore — localStorage adapter for production records.
 *
 * CRITICAL — Snapshot integrity:
 *   productPriceSnapshot and operatorRateSnapshot are set once on create()
 *   and are permanently stripped from any update() payload. This guarantees
 *   historical financial accuracy regardless of future price changes.
 *
 * All methods return Promises so production.js is agnostic about storage.
 * Flip USE_LOCAL_STORE in this file to switch the entire data layer.
 */
const LocalProductionStore = {
  /**
   * Return all production records from localStorage.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_productionStore.read());
  },

  /**
   * Create a new production record.
   * Expects `productPriceSnapshot` and `operatorRateSnapshot` already set
   * in `data` by the module (the module reads the live price and stamps it).
   * Assigns `id` and `createdAt` automatically.
   * @param {Object} data  - Complete record fields including both snapshots
   * @returns {Promise<Object>}  The persisted record with its new id
   */
  create(data) {
    const records = _productionStore.read();

    const newRecord = {
      ...data,
      id:        _productionStore.generateId(),
      createdAt: new Date().toISOString(),
    };

    records.push(newRecord);
    _productionStore.write(records);

    return Promise.resolve(newRecord);
  },

  /**
   * Update an existing production record.
   *
   * SNAPSHOT PROTECTION: productPriceSnapshot and operatorRateSnapshot are
   * always preserved from the original record — they are explicitly removed
   * from the incoming `data` before merging so callers cannot overwrite them.
   *
   * `id` and `createdAt` are also immutable.
   *
   * @param {string} id
   * @param {Object} data  - Fields to update (snapshots will be ignored)
   * @returns {Promise<Object>}  The updated record
   */
  update(id, data) {
    const records = _productionStore.read();
    const index   = records.findIndex(r => String(r.id) === String(id));

    if (index === -1) {
      return Promise.reject(new Error(`Registro de producción con id "${id}" no encontrado.`));
    }

    // Destructure snapshots out of data so they can never be overwritten
    // eslint-disable-next-line no-unused-vars
    const { productPriceSnapshot, operatorRateSnapshot, id: _id, createdAt: _ca, ...safeData } = data;

    const updated = {
      ...records[index],  // base: keep everything including both snapshots
      ...safeData,        // apply allowed changes (quantity, shift, operator, etc.)
      id:        records[index].id,               // immutable
      createdAt: records[index].createdAt,        // immutable
      productPriceSnapshot:  records[index].productPriceSnapshot,  // immutable
      operatorRateSnapshot:  records[index].operatorRateSnapshot,  // immutable
      updatedAt: new Date().toISOString(),
    };

    records[index] = updated;
    _productionStore.write(records);

    return Promise.resolve(updated);
  },

  /**
   * Permanently delete a production record by id.
   * Allowed in the prototype phase for correcting data entry errors.
   * @param {string} id
   * @returns {Promise<null>}
   */
  remove(id) {
    const records  = _productionStore.read();
    const filtered = records.filter(r => String(r.id) !== String(id));

    if (filtered.length === records.length) {
      return Promise.reject(new Error(`Registro de producción con id "${id}" no encontrado.`));
    }

    _productionStore.write(filtered);
    return Promise.resolve(null);
  },
};

// =============================================================================
// PRODUCTION — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestProductionStore — REST adapter for production records.
 * Identical interface to LocalProductionStore for zero-friction swap.
 * The backend is responsible for enforcing snapshot immutability server-side.
 */
const RestProductionStore = {
  getAll:  ()         => _request('/production'),
  create:  (data)     => _request('/production',         { method: 'POST',   body: data }),
  update:  (id, data) => _request(`/production/${id}`,   { method: 'PUT',    body: data }),
  remove:  (id)       => _request(`/production/${id}`,   { method: 'DELETE' }),
};

// =============================================================================
// PRODUCTION EXPORT — Single switchable interface
// =============================================================================

/**
 * ProductionAPI is the one symbol imported by production.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const ProductionAPI = USE_LOCAL_STORE ? LocalProductionStore : RestProductionStore;

// =============================================================================
// OPERATORS — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key used to persist the operators array. */
const STORAGE_KEY_OPERATORS = 'capflow_operators';

/**
 * Low-level read/write helpers scoped to the operators collection.
 * Mirrors the pattern used by Products and Machines — fully independent.
 */
const _operatorStore = {
  /** Read operators array from localStorage. Returns [] on parse failure. */
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_OPERATORS)) || [];
    } catch {
      return [];
    }
  },

  /** Persist the full operators array to localStorage. */
  write(operators) {
    localStorage.setItem(STORAGE_KEY_OPERATORS, JSON.stringify(operators));
  },

  /** Generate a collision-resistant unique ID (timestamp + random suffix). */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * LocalOperatorsStore — localStorage adapter for operators.
 *
 * Operators are never permanently deleted — they are deactivated/activated.
 * This preserves the integrity of historical production records that reference
 * a deactivated operator's id.
 *
 * All methods return Promises so production.js is agnostic about storage.
 */
const LocalOperatorsStore = {
  /**
   * Return all operators from localStorage.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_operatorStore.read());
  },

  /**
   * Create a new operator.
   * Assigns `id`, sets `isActive: true`, and stamps `createdAt`.
   * @param {Object} data  - Operator fields from the form (name, etc.)
   * @returns {Promise<Object>}  The persisted operator with its new id
   */
  create(data) {
    const operators = _operatorStore.read();

    const newOperator = {
      ...data,
      id:        _operatorStore.generateId(),
      isActive:  data.isActive !== undefined ? data.isActive : true,
      createdAt: new Date().toISOString(),
    };

    operators.push(newOperator);
    _operatorStore.write(operators);

    return Promise.resolve(newOperator);
  },

  /**
   * Update an existing operator's fields.
   * `id` and `createdAt` are always preserved regardless of `data` content.
   * @param {string} id
   * @param {Object} data  - Fields to update (e.g. name)
   * @returns {Promise<Object>}  The updated operator
   */
  update(id, data) {
    const operators = _operatorStore.read();
    const index     = operators.findIndex(o => String(o.id) === String(id));

    if (index === -1) {
      return Promise.reject(new Error(`Operario con id "${id}" no encontrado.`));
    }

    const updated = {
      ...operators[index],  // preserve existing fields
      ...data,              // apply incoming changes
      id:        operators[index].id,        // id is immutable
      createdAt: operators[index].createdAt, // createdAt is immutable
      updatedAt: new Date().toISOString(),
    };

    operators[index] = updated;
    _operatorStore.write(operators);

    return Promise.resolve(updated);
  },

  /**
   * Deactivate an operator (set isActive = false).
   * Operators are never permanently deleted — historical records must remain legible.
   * @param {string} id
   * @returns {Promise<Object>}  The updated operator
   */
  deactivate(id) {
    return LocalOperatorsStore.update(id, { isActive: false });
  },

  /**
   * Activate a previously deactivated operator (set isActive = true).
   * @param {string} id
   * @returns {Promise<Object>}  The updated operator
   */
  activate(id) {
    return LocalOperatorsStore.update(id, { isActive: true });
  },
};

// =============================================================================
// OPERATORS — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestOperatorsStore — REST adapter for operators.
 * Identical interface to LocalOperatorsStore for zero-friction swap.
 */
const RestOperatorsStore = {
  getAll:     ()         => _request('/operators'),
  create:     (data)     => _request('/operators',                  { method: 'POST', body: data }),
  update:     (id, data) => _request(`/operators/${id}`,            { method: 'PUT',  body: data }),
  deactivate: (id)       => _request(`/operators/${id}/deactivate`, { method: 'PUT' }),
  activate:   (id)       => _request(`/operators/${id}/activate`,   { method: 'PUT' }),
};

// =============================================================================
// OPERATORS EXPORT — Single switchable interface
// =============================================================================

/**
 * OperatorsAPI is the one symbol imported by production.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const OperatorsAPI = USE_LOCAL_STORE ? LocalOperatorsStore : RestOperatorsStore;

// =============================================================================
// PROVIDERS — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key used to persist the providers array. */
const STORAGE_KEY_PROVIDERS = 'capflow_providers';

/**
 * Low-level read/write helpers scoped to the providers collection.
 * Mirrors the pattern used by Operators — fully independent.
 */
const _providerStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_PROVIDERS)) || [];
    } catch {
      return [];
    }
  },
  write(providers) {
    localStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(providers));
  },
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * LocalProvidersStore — localStorage adapter for material suppliers.
 *
 * Providers are never permanently deleted — they are deactivated/activated.
 * Raw material purchase records reference supplierId; hard-deleting a provider
 * would orphan historical records.
 */
const LocalProvidersStore = {
  getAll() {
    return Promise.resolve(_providerStore.read());
  },

  create(data) {
    const providers  = _providerStore.read();
    const newProvider = {
      ...data,
      id:        _providerStore.generateId(),
      isActive:  true,
      createdAt: new Date().toISOString(),
    };
    providers.push(newProvider);
    _providerStore.write(providers);
    return Promise.resolve(newProvider);
  },

  update(id, data) {
    const providers = _providerStore.read();
    const index     = providers.findIndex(p => String(p.id) === String(id));
    if (index === -1) {
      return Promise.reject(new Error(`Proveedor con id "${id}" no encontrado.`));
    }
    const updated = {
      ...providers[index],
      ...data,
      id:        providers[index].id,
      createdAt: providers[index].createdAt,
      updatedAt: new Date().toISOString(),
    };
    providers[index] = updated;
    _providerStore.write(providers);
    return Promise.resolve(updated);
  },

  deactivate(id) {
    return LocalProvidersStore.update(id, { isActive: false });
  },

  activate(id) {
    return LocalProvidersStore.update(id, { isActive: true });
  },
};

// =============================================================================
// PROVIDERS — REST API Adapter (Production Phase)
// =============================================================================

const RestProvidersStore = {
  getAll:     ()         => _request('/providers'),
  create:     (data)     => _request('/providers',                  { method: 'POST', body: data }),
  update:     (id, data) => _request(`/providers/${id}`,            { method: 'PUT',  body: data }),
  deactivate: (id)       => _request(`/providers/${id}/deactivate`, { method: 'PUT' }),
  activate:   (id)       => _request(`/providers/${id}/activate`,   { method: 'PUT' }),
};

/**
 * ProvidersAPI is the one symbol imported by rawMaterials.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const ProvidersAPI = USE_LOCAL_STORE ? LocalProvidersStore : RestProvidersStore;

// =============================================================================
// RAW MATERIALS — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key used to persist raw material purchase records. */
const STORAGE_KEY_RAW_MATERIALS = 'capflow_raw_materials';

const _rawMaterialStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_RAW_MATERIALS)) || [];
    } catch {
      return [];
    }
  },
  write(records) {
    localStorage.setItem(STORAGE_KEY_RAW_MATERIALS, JSON.stringify(records));
  },
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * LocalRawMaterialsStore — localStorage adapter for raw material purchases.
 *
 * Records are purchase entries only — no inventory tracking, no FIFO.
 * Hard delete is permitted (correcting data entry errors).
 * Recycled records carry washedWeightLbs and washingCost.
 * Pellet records may omit those fields (default 0).
 */
const LocalRawMaterialsStore = {
  getAll() {
    return Promise.resolve(_rawMaterialStore.read());
  },

  create(data) {
    const records   = _rawMaterialStore.read();
    const newRecord = {
      ...data,
      id:        _rawMaterialStore.generateId(),
      createdAt: new Date().toISOString(),
    };
    records.push(newRecord);
    _rawMaterialStore.write(records);
    return Promise.resolve(newRecord);
  },

  update(id, data) {
    const records = _rawMaterialStore.read();
    const index   = records.findIndex(r => String(r.id) === String(id));
    if (index === -1) {
      return Promise.reject(new Error(`Registro de materia prima con id "${id}" no encontrado.`));
    }
    const updated = {
      ...records[index],
      ...data,
      id:        records[index].id,
      createdAt: records[index].createdAt,
      updatedAt: new Date().toISOString(),
    };
    records[index] = updated;
    _rawMaterialStore.write(records);
    return Promise.resolve(updated);
  },

  remove(id) {
    const records  = _rawMaterialStore.read();
    const filtered = records.filter(r => String(r.id) !== String(id));
    if (filtered.length === records.length) {
      return Promise.reject(new Error(`Registro de materia prima con id "${id}" no encontrado.`));
    }
    _rawMaterialStore.write(filtered);
    return Promise.resolve(null);
  },
};

// =============================================================================
// RAW MATERIALS — REST API Adapter (Production Phase)
// =============================================================================

const RestRawMaterialsStore = {
  getAll:  ()         => _request('/raw-materials'),
  create:  (data)     => _request('/raw-materials',         { method: 'POST',   body: data }),
  update:  (id, data) => _request(`/raw-materials/${id}`,   { method: 'PUT',    body: data }),
  remove:  (id)       => _request(`/raw-materials/${id}`,   { method: 'DELETE' }),
};

/**
 * RawMaterialsAPI is the one symbol imported by rawMaterials.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const RawMaterialsAPI = USE_LOCAL_STORE ? LocalRawMaterialsStore : RestRawMaterialsStore;

// =============================================================================
// MONTHLY INVENTORY — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key used to persist monthly closing inventory records. */
const STORAGE_KEY_MONTHLY_INVENTORY = 'capflow_monthly_inventory';

/**
 * Low-level read/write helpers scoped to the monthly inventory collection.
 * One record per YYYY-MM month. Upsert replaces the existing record for that
 * month rather than appending a second one.
 */
const _monthlyInventoryStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_MONTHLY_INVENTORY)) || [];
    } catch {
      return [];
    }
  },
  write(records) {
    localStorage.setItem(STORAGE_KEY_MONTHLY_INVENTORY, JSON.stringify(records));
  },
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * Private month normalizer for the API layer.
 * Ensures stored months are always "YYYY-MM" with a leading zero.
 * Mirrors the normalizeMonth() helper in rawMaterials.js but lives here so
 * the adapter is self-contained and does not depend on the module layer.
 * @param {string} month
 * @returns {string}
 */
function _normalizeApiMonth(month) {
  if (!month) return '';
  const [y, m] = month.split('-');
  return `${y}-${(m || '01').padStart(2, '0')}`;
}

/**
 * LocalMonthlyInventoryStore — localStorage adapter for monthly closing inventory.
 *
 * One record per YYYY-MM. upsert() creates a new record if none exists for
 * that month, or replaces the existing one in place.
 * No deactivate — records are updated, never deleted.
 */
const LocalMonthlyInventoryStore = {
  /**
   * Return all monthly inventory records with month strings normalized.
   * Normalizing on read heals any legacy records stored without a leading zero
   * (e.g. "2026-2") so the module layer always receives clean "YYYY-MM" strings.
   * @returns {Promise<Array>}
   */
  getAll() {
    const raw       = _monthlyInventoryStore.read();
    const normalize = raw.map(r => ({ ...r, month: _normalizeApiMonth(r.month) }));
    return Promise.resolve(normalize);
  },

  /**
   * Return the inventory record for a specific month, or null.
   * Normalizes both the query and stored values so "2026-2" matches "2026-02".
   * @param {string} month  - YYYY-MM
   * @returns {Promise<Object|null>}
   */
  getByMonth(month) {
    const norm    = _normalizeApiMonth(month);
    const records = _monthlyInventoryStore.read();
    // Normalize both sides — guards against stale un-padded stored values
    const found   = records.find(r => _normalizeApiMonth(r.month) === norm) ?? null;
    return Promise.resolve(found ? { ...found, month: norm } : null);
  },

  /**
   * Create or replace the inventory record for a given month.
   *
   * Always stores `month` in normalized "YYYY-MM" form.
   * findIndex normalizes both sides so a stale "2026-2" record is treated as
   * the same month as an incoming "2026-02" — no duplicates are created.
   * Preserves original `id` and `createdAt` on replacement.
   *
   * @param {Object} data  - { month, recycledClosingLbs, pelletClosingLbs }
   * @returns {Promise<Object>}  The persisted (normalized) record
   */
  upsert(data) {
    const normMonth = _normalizeApiMonth(data.month);
    const records   = _monthlyInventoryStore.read();

    // Normalize both sides so stale "YYYY-M" entries are still found
    const index = records.findIndex(
      r => _normalizeApiMonth(r.month) === normMonth
    );

    if (index !== -1) {
      // Replace in place: heal the stored month string and update data fields
      const updated = {
        ...records[index],
        month:              normMonth,           // heal any un-padded stored value
        recycledClosingLbs: Number(data.recycledClosingLbs) || 0,
        pelletClosingLbs:   Number(data.pelletClosingLbs)   || 0,
        updatedAt:          new Date().toISOString(),
      };
      records[index] = updated;
      _monthlyInventoryStore.write(records);
      return Promise.resolve(updated);
    }

    // No existing record — create a new one
    const newRecord = {
      month:              normMonth,
      recycledClosingLbs: Number(data.recycledClosingLbs) || 0,
      pelletClosingLbs:   Number(data.pelletClosingLbs)   || 0,
      id:                 _monthlyInventoryStore.generateId(),
      createdAt:          new Date().toISOString(),
    };
    records.push(newRecord);
    _monthlyInventoryStore.write(records);
    return Promise.resolve(newRecord);
  },
};

// =============================================================================
// MONTHLY INVENTORY — REST API Adapter (Production Phase)
// =============================================================================

const RestMonthlyInventoryStore = {
  getAll:      ()       => _request('/monthly-inventory'),
  getByMonth:  (month)  => _request(`/monthly-inventory/${month}`),
  upsert:      (data)   => _request('/monthly-inventory', { method: 'PUT', body: data }),
};

// =============================================================================
// MONTHLY INVENTORY EXPORT — Single switchable interface
// =============================================================================

/**
 * MonthlyInventoryAPI is the one symbol imported by rawMaterials.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const MonthlyInventoryAPI = USE_LOCAL_STORE
  ? LocalMonthlyInventoryStore
  : RestMonthlyInventoryStore;

// =============================================================================
// CLIENTS — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key for the clients array. */
const STORAGE_KEY_CLIENTS = 'capflow_clients';

const _clientStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_CLIENTS)) || []; }
    catch { return []; }
  },
  write(records) { localStorage.setItem(STORAGE_KEY_CLIENTS, JSON.stringify(records)); },
  generateId()   { return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

/**
 * LocalClientsStore — localStorage adapter for clients.
 *
 * Schema: id, name, rnc, phone, email, address, notes, active, createdAt, updatedAt
 * Soft-delete only: remove() sets active=false, never erases the record.
 */
const LocalClientsStore = {
  getAll() {
    return Promise.resolve(_clientStore.read());
  },

  getById(id) {
    const found = _clientStore.read().find(c => String(c.id) === String(id));
    return Promise.resolve(found ?? null);
  },

  create(data) {
    const records = _clientStore.read();
    const rec = {
      id:        _clientStore.generateId(),
      name:      (data.name    || '').trim(),
      rnc:       (data.rnc     || '').trim(),
      phone:     (data.phone   || '').trim(),
      email:     (data.email   || '').trim(),
      address:   (data.address || '').trim(),
      notes:     (data.notes   || '').trim(),
      active:    data.active !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    records.push(rec);
    _clientStore.write(records);
    return Promise.resolve(rec);
  },

  update(id, data) {
    const records = _clientStore.read();
    const index   = records.findIndex(c => String(c.id) === String(id));
    if (index === -1) return Promise.reject(new Error(`Cliente con id "${id}" no encontrado.`));
    const prev = records[index];
    const updated = {
      id:        prev.id,
      createdAt: prev.createdAt,
      name:      data.name    !== undefined ? (data.name    || '').trim() : prev.name,
      rnc:       data.rnc     !== undefined ? (data.rnc     || '').trim() : prev.rnc,
      phone:     data.phone   !== undefined ? (data.phone   || '').trim() : prev.phone,
      email:     data.email   !== undefined ? (data.email   || '').trim() : prev.email,
      address:   data.address !== undefined ? (data.address || '').trim() : prev.address,
      notes:     data.notes   !== undefined ? (data.notes   || '').trim() : prev.notes,
      active:    data.active  !== undefined ? Boolean(data.active)        : prev.active,
      updatedAt: new Date().toISOString(),
    };
    records[index] = updated;
    _clientStore.write(records);
    return Promise.resolve(updated);
  },

  /** Soft-delete: sets active=false. */
  remove(id) {
    return LocalClientsStore.update(id, { active: false });
  },

  setStatus(id, active) {
    return LocalClientsStore.update(id, { active });
  },
};

// =============================================================================
// CLIENTS — REST API Adapter (Production Phase)
// =============================================================================

const RestClientsStore = {
  getAll:    ()          => _request('/clients'),
  getById:   (id)        => _request(`/clients/${id}`),
  create:    (data)      => _request('/clients',             { method: 'POST',   body: data }),
  update:    (id, data)  => _request(`/clients/${id}`,       { method: 'PUT',    body: data }),
  remove:    (id)        => _request(`/clients/${id}/deactivate`, { method: 'PUT' }),
  setStatus: (id, active)=> _request(`/clients/${id}/status`, { method: 'PUT',   body: { active } }),
};

// =============================================================================
// CLIENTS EXPORT
// =============================================================================

/**
 * ClientsAPI — imported by clients.js and sales.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const ClientsAPI = USE_LOCAL_STORE ? LocalClientsStore : RestClientsStore;

// =============================================================================
// SALES — localStorage Adapter (Prototype Phase)
//
// Sale records embed their line items and attachments directly — no separate
// SaleLines collection. This keeps the data model simple for localStorage.
//
// New schema (v2):
//   id, createdAt, updatedAt,
//   saleDate (YYYY-MM-DD), month (YYYY-MM),
//   clientId, status ('confirmed'),
//   notes, invoiceNumber,
//   totals: { revenue, cost, profit, margin },
//   attachments: [{ id, name, mime, size, dataUrl }],
//   lines: [{
//     id, productId, productType ('manufactured'|'resale'),
//     quantity, unitPrice, lineRevenue,
//     costPerUnitSnapshot, lineCost, lineProfit,
//     resaleCostPerUnitInput
//   }]
//
// Legacy v1 records (invoiceNumber, totalAmount, documentBase64) are
// normalized on every read via _migrateSale() — no migration script needed.
// =============================================================================

/** localStorage key for the sales array. */
const STORAGE_KEY_SALES = 'capflow_sales';

const _salesStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SALES)) || []; }
    catch { return []; }
  },
  write(records) { localStorage.setItem(STORAGE_KEY_SALES, JSON.stringify(records)); },
  generateId()   { return `sale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

/**
 * Normalize a raw stored sale record to the current v2 schema.
 * Handles v1 records that used invoiceNumber/totalAmount/documentBase64.
 * Applied on every read — never modifies stored bytes.
 * @param {Object} raw
 * @returns {Object}
 */
function _migrateSale(raw) {
  const saleDate = raw.saleDate || raw.date || '';

  // Migrate v1 single-document to attachments array
  let attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  if (!attachments.length && raw.documentBase64) {
    attachments = [{
      id:      `att-v1-${raw.id}`,
      name:    'Documento adjunto',
      mime:    raw.documentType || 'application/octet-stream',
      size:    0,
      dataUrl: raw.documentBase64,
    }];
  }

  // Migrate v1 flat totals
  const totals = raw.totals && typeof raw.totals === 'object'
    ? raw.totals
    : {
        revenue: Number(raw.totalAmount)  || 0,
        cost:    Number(raw.totalCost)    || 0,
        profit:  Number(raw.totalProfit)  || 0,
        margin:  0,
      };

  return {
    id:            raw.id,
    createdAt:     raw.createdAt,
    updatedAt:     raw.updatedAt || raw.createdAt,
    saleDate,
    month:         saleDate.slice(0, 7),
    clientId:      raw.clientId      || '',
    status:        raw.status        || 'confirmed',
    notes:         raw.notes         || '',
    invoiceNumber: raw.invoiceNumber || '',
    totals,
    attachments,
    lines:         Array.isArray(raw.lines) ? raw.lines : [],
  };
}

/**
 * LocalSalesStore — localStorage adapter for sale records (v2 embedded schema).
 */
const LocalSalesStore = {
  getAll() {
    return Promise.resolve(_salesStore.read().map(_migrateSale));
  },

  getById(id) {
    const found = _salesStore.read().find(s => String(s.id) === String(id));
    return Promise.resolve(found ? _migrateSale(found) : null);
  },

  create(data) {
    const records  = _salesStore.read();
    const saleDate = data.saleDate || '';
    const now      = new Date().toISOString();
    const rec = {
      id:            _salesStore.generateId(),
      createdAt:     now,
      updatedAt:     now,
      saleDate,
      month:         saleDate.slice(0, 7),
      clientId:      String(data.clientId      || ''),
      status:        data.status               || 'confirmed',
      notes:         (data.notes               || '').trim(),
      invoiceNumber: (data.invoiceNumber        || '').trim(),
      totals:        data.totals               || { revenue: 0, cost: 0, profit: 0, margin: 0 },
      attachments:   Array.isArray(data.attachments) ? data.attachments : [],
      lines:         Array.isArray(data.lines)        ? data.lines        : [],
    };
    records.push(rec);
    _salesStore.write(records);
    return Promise.resolve(rec);
  },

  update(id, data) {
    const records = _salesStore.read();
    const index   = records.findIndex(s => String(s.id) === String(id));
    if (index === -1) return Promise.reject(new Error(`Venta con id "${id}" no encontrada.`));
    const prev     = _migrateSale(records[index]);
    const saleDate = data.saleDate !== undefined ? (data.saleDate || '') : prev.saleDate;
    const updated  = {
      id:            prev.id,
      createdAt:     prev.createdAt,
      updatedAt:     new Date().toISOString(),
      saleDate,
      month:         saleDate.slice(0, 7),
      clientId:      data.clientId      !== undefined ? String(data.clientId)          : prev.clientId,
      status:        data.status        !== undefined ? (data.status || 'confirmed')    : prev.status,
      notes:         data.notes         !== undefined ? (data.notes || '').trim()       : prev.notes,
      invoiceNumber: data.invoiceNumber !== undefined ? (data.invoiceNumber || '').trim() : prev.invoiceNumber,
      totals:        data.totals        !== undefined ? data.totals                     : prev.totals,
      attachments:   data.attachments   !== undefined ? data.attachments                : prev.attachments,
      lines:         data.lines         !== undefined ? data.lines                      : prev.lines,
    };
    records[index] = updated;
    _salesStore.write(records);
    return Promise.resolve(updated);
  },

  remove(id) {
    const records  = _salesStore.read();
    const filtered = records.filter(s => String(s.id) !== String(id));
    if (filtered.length === records.length) {
      return Promise.reject(new Error(`Venta con id "${id}" no encontrada.`));
    }
    _salesStore.write(filtered);
    return Promise.resolve(null);
  },
};

// =============================================================================
// SALES — REST API Adapter (Production Phase)
// =============================================================================

const RestSalesStore = {
  getAll:  ()         => _request('/sales'),
  getById: (id)       => _request(`/sales/${id}`),
  create:  (data)     => _request('/sales',        { method: 'POST',   body: data }),
  update:  (id, data) => _request(`/sales/${id}`,  { method: 'PUT',    body: data }),
  remove:  (id)       => _request(`/sales/${id}`,  { method: 'DELETE' }),
};

// =============================================================================
// SALES EXPORT
// =============================================================================

/**
 * SalesAPI — imported by sales.js.
 * Embeds line items and attachments directly on each sale record.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const SalesAPI = USE_LOCAL_STORE ? LocalSalesStore : RestSalesStore;

// =============================================================================
// SALE LINES — localStorage Adapter (Prototype Phase)
// =============================================================================

/** localStorage key for the sale lines array. */
const STORAGE_KEY_SALE_LINES = 'capflow_sale_lines';

const _saleLinesStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SALE_LINES)) || []; }
    catch { return []; }
  },
  write(records) { localStorage.setItem(STORAGE_KEY_SALE_LINES, JSON.stringify(records)); },
  generateId()   { return `sl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

/**
 * LocalSaleLinesStore — localStorage adapter for individual sale line records.
 *
 * Schema:
 *   id, saleId, productId,
 *   quantity, salePricePerUnit, saleLineTotal,
 *   costPerUnitSnapshot, costLineTotal, profitLine,
 *   createdAt, updatedAt
 *
 * Line totals are recalculated from quantity × price / cost on every
 * create() and update() so the stored values are always consistent.
 */
const LocalSaleLinesStore = {
  getAll() {
    return Promise.resolve(_saleLinesStore.read());
  },

  getById(id) {
    const found = _saleLinesStore.read().find(l => String(l.id) === String(id));
    return Promise.resolve(found ?? null);
  },

  getBySaleId(saleId) {
    const lines = _saleLinesStore.read()
      .filter(l => String(l.saleId) === String(saleId));
    return Promise.resolve(lines);
  },

  create(data) {
    const records = _saleLinesStore.read();
    const qty     = Number(data.quantity)            || 0;
    const price   = Number(data.salePricePerUnit)    || 0;
    const cost    = Number(data.costPerUnitSnapshot)  || 0;
    const rec = {
      id:                  _saleLinesStore.generateId(),
      saleId:              String(data.saleId),
      productId:           String(data.productId),
      quantity:            qty,
      salePricePerUnit:    price,
      saleLineTotal:       qty * price,
      costPerUnitSnapshot: cost,
      costLineTotal:       qty * cost,
      profitLine:          qty * price - qty * cost,
      createdAt:           new Date().toISOString(),
      updatedAt:           new Date().toISOString(),
    };
    records.push(rec);
    _saleLinesStore.write(records);
    return Promise.resolve(rec);
  },

  update(id, data) {
    const records = _saleLinesStore.read();
    const index   = records.findIndex(l => String(l.id) === String(id));
    if (index === -1) return Promise.reject(new Error(`Línea de venta con id "${id}" no encontrada.`));
    const prev  = records[index];
    const qty   = data.quantity            !== undefined ? Number(data.quantity)            : prev.quantity;
    const price = data.salePricePerUnit    !== undefined ? Number(data.salePricePerUnit)    : prev.salePricePerUnit;
    const cost  = data.costPerUnitSnapshot !== undefined ? Number(data.costPerUnitSnapshot) : prev.costPerUnitSnapshot;
    const updated = {
      id:                  prev.id,
      saleId:              prev.saleId,
      createdAt:           prev.createdAt,
      productId:           data.productId !== undefined ? String(data.productId) : prev.productId,
      quantity:            qty,
      salePricePerUnit:    price,
      saleLineTotal:       qty * price,
      costPerUnitSnapshot: cost,
      costLineTotal:       qty * cost,
      profitLine:          qty * price - qty * cost,
      updatedAt:           new Date().toISOString(),
    };
    records[index] = updated;
    _saleLinesStore.write(records);
    return Promise.resolve(updated);
  },

  remove(id) {
    const records  = _saleLinesStore.read();
    const filtered = records.filter(l => String(l.id) !== String(id));
    if (filtered.length === records.length) {
      return Promise.reject(new Error(`Línea de venta con id "${id}" no encontrada.`));
    }
    _saleLinesStore.write(filtered);
    return Promise.resolve(null);
  },

  /**
   * Remove all lines belonging to a given sale.
   * Called by sales.js when deleting a sale header.
   * @param {string} saleId
   * @returns {Promise<{ deleted: number }>}
   */
  removeBySaleId(saleId) {
    const records  = _saleLinesStore.read();
    const filtered = records.filter(l => String(l.saleId) !== String(saleId));
    _saleLinesStore.write(filtered);
    return Promise.resolve({ deleted: records.length - filtered.length });
  },
};

// =============================================================================
// SALE LINES — REST API Adapter (Production Phase)
// =============================================================================

const RestSaleLinesStore = {
  getAll:        ()         => _request('/sale-lines'),
  getById:       (id)       => _request(`/sale-lines/${id}`),
  getBySaleId:   (saleId)   => _request(`/sales/${saleId}/lines`),
  create:        (data)     => _request('/sale-lines',       { method: 'POST',   body: data }),
  update:        (id, data) => _request(`/sale-lines/${id}`, { method: 'PUT',    body: data }),
  remove:        (id)       => _request(`/sale-lines/${id}`, { method: 'DELETE' }),
  removeBySaleId:(saleId)   => _request(`/sales/${saleId}/lines`, { method: 'DELETE' }),
};

// =============================================================================
// SALE LINES EXPORT
// =============================================================================

/**
 * SaleLinesAPI — imported by sales.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const SaleLinesAPI = USE_LOCAL_STORE ? LocalSaleLinesStore : RestSaleLinesStore;

// =============================================================================
// CUSTOMERS — localStorage Adapter (Prototype Phase)
//
// Schema:
//   id          string   — collision-resistant unique key
//   name        string   — required; duplicate names are rejected by the UI layer
//   type        string   — 'company' | 'individual'
//   phone       string   — optional
//   email       string   — optional
//   address     string   — optional
//   taxId       string   — optional (RNC / cédula)
//   status      string   — 'active' | 'inactive'  (never hard-deleted)
//   createdAt   number   — Unix timestamp (Date.now())
//   updatedAt   number   — Unix timestamp, updated on every write
//
// Customers are NEVER hard-deleted.
// softDelete(id) sets status → 'inactive' and is the only removal operation.
// =============================================================================

/** localStorage key used to persist the customers array. */
const STORAGE_KEY_CUSTOMERS = 'capflow_customers';

/**
 * Low-level read/write helpers scoped to the customers collection.
 * Mirrors the _store pattern used by LocalProductsStore — fully independent.
 */
const _customerStore = {
  /** Read customers array from localStorage. Returns [] on parse failure. */
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOMERS)) || [];
    } catch {
      return [];
    }
  },

  /** Persist the full customers array to localStorage. */
  write(records) {
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(records));
  },

  /** Generate a collision-resistant unique ID (timestamp + random suffix). */
  generateId() {
    return `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * LocalCustomersStore — localStorage adapter for customers.
 *
 * All methods return Promises so customers.js is agnostic about
 * the underlying storage. Flip USE_LOCAL_STORE to swap to the REST adapter.
 */
const LocalCustomersStore = {
  /**
   * Return all customers from localStorage.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_customerStore.read());
  },

  /**
   * Return a single customer by id, or null if not found.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  getById(id) {
    const found = _customerStore.read().find(c => String(c.id) === String(id));
    return Promise.resolve(found ?? null);
  },

  /**
   * Create a new customer and persist it.
   * Assigns id, status: 'active', and createdAt automatically.
   * updatedAt is set to the same value as createdAt on first write.
   * @param {Object} data  - { name, type, phone?, email?, address?, taxId? }
   * @returns {Promise<Object>}  The newly created customer
   */
  create(data) {
    const records = _customerStore.read();
    const now     = Date.now();

    const rec = {
      id:        _customerStore.generateId(),
      name:      (data.name    || '').trim(),
      type:      data.type     || 'company',
      phone:     (data.phone   || '').trim(),
      email:     (data.email   || '').trim(),
      address:   (data.address || '').trim(),
      taxId:     (data.taxId   || '').trim(),
      status:    'active',
      createdAt: now,
      updatedAt: now,
    };

    records.push(rec);
    _customerStore.write(records);
    return Promise.resolve(rec);
  },

  /**
   * Update allowed fields on an existing customer.
   * `id` and `createdAt` are always preserved.
   * `status` can be updated via this method or via softDelete/setStatus.
   * @param {string} id
   * @param {Object} data  - Any subset of { name, type, phone, email, address, taxId, status }
   * @returns {Promise<Object>}  The updated customer
   */
  update(id, data) {
    const records = _customerStore.read();
    const index   = records.findIndex(c => String(c.id) === String(id));

    if (index === -1) {
      return Promise.reject(new Error(`Cliente con id "${id}" no encontrado.`));
    }

    const prev    = records[index];
    const updated = {
      id:        prev.id,        // immutable
      createdAt: prev.createdAt, // immutable
      name:      data.name    !== undefined ? (data.name    || '').trim() : prev.name,
      type:      data.type    !== undefined ? (data.type    || prev.type)  : prev.type,
      phone:     data.phone   !== undefined ? (data.phone   || '').trim() : prev.phone,
      email:     data.email   !== undefined ? (data.email   || '').trim() : prev.email,
      address:   data.address !== undefined ? (data.address || '').trim() : prev.address,
      taxId:     data.taxId   !== undefined ? (data.taxId   || '').trim() : prev.taxId,
      status:    data.status  !== undefined ? data.status                  : prev.status,
      updatedAt: Date.now(),
    };

    records[index] = updated;
    _customerStore.write(records);
    return Promise.resolve(updated);
  },

  /**
   * Soft-delete a customer: sets status → 'inactive'.
   * Customers are never hard-deleted — this is the only removal operation.
   * @param {string} id
   * @returns {Promise<Object>}  The updated customer
   */
  softDelete(id) {
    return LocalCustomersStore.update(id, { status: 'inactive' });
  },

  /**
   * Reactivate a previously deactivated customer.
   * @param {string} id
   * @returns {Promise<Object>}  The updated customer
   */
  reactivate(id) {
    return LocalCustomersStore.update(id, { status: 'active' });
  },
};

// =============================================================================
// CUSTOMERS — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestCustomersStore — REST adapter for customers.
 * Identical interface to LocalCustomersStore for zero-friction swap.
 */
const RestCustomersStore = {
  getAll:     ()          => _request('/customers'),
  getById:    (id)        => _request(`/customers/${id}`),
  create:     (data)      => _request('/customers',                  { method: 'POST',  body: data }),
  update:     (id, data)  => _request(`/customers/${id}`,            { method: 'PUT',   body: data }),
  softDelete: (id)        => _request(`/customers/${id}/deactivate`, { method: 'PATCH' }),
  reactivate: (id)        => _request(`/customers/${id}/reactivate`, { method: 'PATCH' }),
};

// =============================================================================
// CUSTOMERS EXPORT — Single switchable interface
// =============================================================================

/**
 * CustomersAPI — imported by customers.js and sales.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const CustomersAPI = USE_LOCAL_STORE ? LocalCustomersStore : RestCustomersStore;

// =============================================================================
// INVESTOR — localStorage Adapter (Prototype Phase)
//
// This module tracks a SINGLE investor relationship structured as a loan.
// There is exactly one investor record in storage. The record is initialized
// via create() and subsequently mutated only through addInvestment() and
// addAmortization(). The clientId field links to the Customers module so no
// investor name is hardcoded here.
//
// Schema:
//   id          string   — unique record id, set once on create
//   clientId    string   — references a Customer record (name lives there)
//   totalDebt   number   — current outstanding balance; never goes below 0
//   history     Array    — all transactions in chronological order
//     {
//       id          string   — unique entry id for future Sales cross-reference
//       type        string   — 'investment' | 'amortization'
//       amount      number   — always positive; direction implied by type
//       date        number   — Unix timestamp (Date.now())
//       referenceId string?  — optional; will hold a saleId when Sales calls this
//       note        string?  — optional free-text note entered by the user
//     }
//   createdAt   number   — Unix timestamp, set once on create
//   updatedAt   number   — Unix timestamp, updated on every write
//
// Rules enforced at the API layer:
//   • investment  → totalDebt += amount   (always allowed)
//   • amortization → totalDebt -= amount  (rejected if result < 0)
//   • Hard deletes are NOT supported — history is permanent
// =============================================================================

/** localStorage key for the single investor record. */
const STORAGE_KEY_INVESTOR = 'capflow_investor';

/**
 * Low-level read/write helpers for the investor record.
 * Unlike other stores this holds a single Object (or null), not an Array.
 */
const _investorStore = {
  /** Read the investor record. Returns null if nothing is stored yet. */
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_INVESTOR)) ?? null;
    } catch {
      return null;
    }
  },

  /** Persist the investor record. */
  write(record) {
    localStorage.setItem(STORAGE_KEY_INVESTOR, JSON.stringify(record));
  },

  /** Generate a collision-resistant unique ID (timestamp + random suffix). */
  generateId() {
    return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

/**
 * LocalInvestorStore — localStorage adapter for the single investor record.
 *
 * All methods return Promises so investor.js is agnostic about storage.
 * Flip USE_LOCAL_STORE in this file to switch the entire data layer.
 */
const LocalInvestorStore = {
  /**
   * Return the investor record, or null if it has not been created yet.
   * @returns {Promise<Object|null>}
   */
  get() {
    return Promise.resolve(_investorStore.read());
  },

  /**
   * Initialize the investor record.
   * Should only be called once (the first time the module is used).
   * If a record already exists, returns it unchanged.
   *
   * @param {Object} data  - { clientId }
   * @returns {Promise<Object>}  The new (or existing) investor record
   */
  create(data) {
    const existing = _investorStore.read();
    if (existing) return Promise.resolve(existing);

    const now    = Date.now();
    const record = {
      id:        _investorStore.generateId(),
      clientId:  String(data.clientId || ''),
      totalDebt: 0,
      history:   [],
      createdAt: now,
      updatedAt: now,
    };

    _investorStore.write(record);
    return Promise.resolve(record);
  },

  /**
   * Update the clientId reference on an existing investor record.
   * Useful when the linked customer needs to change without resetting debt.
   * @param {string} clientId
   * @returns {Promise<Object>}  The updated record
   */
  updateClient(clientId) {
    const record = _investorStore.read();
    if (!record) return Promise.reject(new Error('No existe un registro de inversionista.'));

    const updated = { ...record, clientId: String(clientId), updatedAt: Date.now() };
    _investorStore.write(updated);
    return Promise.resolve(updated);
  },

  /**
   * Add an investment transaction — increases totalDebt.
   *
   * @param {number}  amount  - Must be > 0
   * @param {string}  [note]  - Optional free-text note
   * @returns {Promise<Object>}  The updated investor record
   */
  addInvestment(amount, note = '') {
    const record = _investorStore.read();
    if (!record) return Promise.reject(new Error('No existe un registro de inversionista.'));

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return Promise.reject(new Error('El monto de inversión debe ser mayor que cero.'));
    }

    const entry = {
      id:          _investorStore.generateId(),
      type:        'investment',
      amount:      amt,
      date:        Date.now(),
      referenceId: null,
      note:        (note || '').trim(),
    };

    const updated = {
      ...record,
      totalDebt: record.totalDebt + amt,
      history:   [...record.history, entry],
      updatedAt: Date.now(),
    };

    _investorStore.write(updated);
    return Promise.resolve(updated);
  },

  /**
   * Add an amortization transaction — decreases totalDebt.
   *
   * Rejects if the amount exceeds current totalDebt (debt cannot go negative).
   * Called manually from investor.js, and will also be called by sales.js in
   * the future via: InvestorAPI.addAmortization(amount, saleId)
   *
   * @param {number}  amount       - Must be > 0 and ≤ totalDebt
   * @param {string}  [referenceId] - Optional; will hold saleId when Sales calls this
   * @param {string}  [note]        - Optional free-text note
   * @returns {Promise<Object>}  The updated investor record
   */
  addAmortization(amount, referenceId = null, note = '') {
    const record = _investorStore.read();
    if (!record) return Promise.reject(new Error('No existe un registro de inversionista.'));

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return Promise.reject(new Error('El monto de amortización debe ser mayor que cero.'));
    }
    if (amt > record.totalDebt) {
      return Promise.reject(new Error(
        `El monto (${amt.toFixed(2)}) supera la deuda actual (${record.totalDebt.toFixed(2)}).`
      ));
    }

    const entry = {
      id:          _investorStore.generateId(),
      type:        'amortization',
      amount:      amt,
      date:        Date.now(),
      referenceId: referenceId ?? null,
      note:        (note || '').trim(),
    };

    const updated = {
      ...record,
      totalDebt: record.totalDebt - amt,
      history:   [...record.history, entry],
      updatedAt: Date.now(),
    };

    _investorStore.write(updated);
    return Promise.resolve(updated);
  },

  /**
   * Return the transaction history array in reverse-chronological order.
   * Convenience method so callers don't need to access record.history directly.
   * @returns {Promise<Array>}
   */
  getHistory() {
    const record = _investorStore.read();
    if (!record) return Promise.resolve([]);
    return Promise.resolve([...record.history].reverse());
  },

  // ── Sale-scoped amortization helpers ──────────────────────────────────────

  /**
   * Compute the net amortization already applied for a given sale referenceId.
   * Sums 'amortization' entries and subtracts 'reversal' entries for that id.
   * Pure synchronous helper — reads store directly.
   * @param {string} referenceId
   * @returns {number}
   */
  _netAmortizationForSale(referenceId) {
    const record = _investorStore.read();
    if (!record) return 0;
    return (record.history || []).reduce((net, entry) => {
      if (String(entry.referenceId) !== String(referenceId)) return net;
      if (entry.type === 'amortization') return net + entry.amount;
      if (entry.type === 'reversal')     return net - entry.amount;
      return net;
    }, 0);
  },

  /**
   * Set the net amortization for a specific sale to exactly targetAmount.
   *
   * • If targetAmount > already applied → addAmortization for the delta.
   * • If targetAmount < already applied → create a 'reversal' history entry
   *   that increases totalDebt back by the difference. History is never deleted.
   * • If equal (within 0.001) → no-op.
   *
   * This is idempotent: calling it twice with the same targetAmount is safe.
   *
   * @param {string} referenceId   - The saleId this amortization is tied to
   * @param {number} targetAmount  - Desired net amortization (≥ 0)
   * @param {string} [note]
   * @returns {Promise<Object>}  The updated investor record
   */
  setSaleAmortization(referenceId, targetAmount, note = '') {
    const record = _investorStore.read();
    if (!record) return Promise.reject(new Error('No existe un registro de inversionista.'));

    const already = this._netAmortizationForSale(referenceId);
    const target  = Math.max(0, Number(targetAmount) || 0);
    const delta   = target - already;

    if (Math.abs(delta) < 0.001) return Promise.resolve(record);   // already correct

    if (delta > 0) {
      // Need to apply more — reuse addAmortization (enforces debt >= 0 check)
      return this.addAmortization(delta, referenceId, note || `Auto amort: ${referenceId}`);
    }

    // Need to reverse the excess amortization
    const reversal = Math.abs(delta);
    const entry = {
      id:          _investorStore.generateId(),
      type:        'reversal',
      amount:      reversal,
      date:        Date.now(),
      referenceId: String(referenceId),
      note:        (note || `Reverso de amort.: ${referenceId}`).trim(),
    };
    const updated = {
      ...record,
      totalDebt: record.totalDebt + reversal,
      history:   [...record.history, entry],
      updatedAt: Date.now(),
    };
    _investorStore.write(updated);
    return Promise.resolve(updated);
  },

  /**
   * Remove all net amortization tied to a specific sale.
   * Shorthand for setSaleAmortization(referenceId, 0, note).
   *
   * @param {string} referenceId  - The saleId whose amortization should be cleared
   * @param {string} [note]
   * @returns {Promise<Object>}  The updated investor record
   */
  clearSaleAmortization(referenceId, note = '') {
    return this.setSaleAmortization(
      referenceId, 0, note || `Reversión por eliminación: ${referenceId}`
    );
  },
};

// =============================================================================
// INVESTOR — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestInvestorStore — REST adapter for the investor record.
 * Identical interface to LocalInvestorStore for zero-friction swap.
 */
const RestInvestorStore = {
  get:                  ()                                  => _request('/investor'),
  create:               (data)                              => _request('/investor',                         { method: 'POST',  body: data }),
  updateClient:         (clientId)                          => _request('/investor/client',                  { method: 'PATCH', body: { clientId } }),
  addInvestment:        (amount, note)                      => _request('/investor/investment',              { method: 'POST',  body: { amount, note } }),
  addAmortization:      (amount, referenceId, note)         => _request('/investor/amortization',            { method: 'POST',  body: { amount, referenceId, note } }),
  getHistory:           ()                                  => _request('/investor/history'),
  setSaleAmortization:  (referenceId, targetAmount, note)   => _request('/investor/sale-amortization',       { method: 'PUT',   body: { referenceId, targetAmount, note } }),
  clearSaleAmortization:(referenceId, note)                 => _request(`/investor/sale-amortization/${referenceId}`, { method: 'DELETE', body: { note } }),
  _netAmortizationForSale: () => 0,   // no-op for REST — server handles this
};

// =============================================================================
// INVESTOR EXPORT — Single switchable interface
// =============================================================================

/**
 * InvestorAPI — imported by investor.js.
 * addAmortization(amount, referenceId?, note?) is the hook that Sales module
 * will call in the future to auto-reduce debt on manufactured-product sales.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const InvestorAPI = USE_LOCAL_STORE ? LocalInvestorStore : RestInvestorStore;

// =============================================================================
// INVENTORY — localStorage Adapter (Prototype Phase)
//
// Two separate collections:
//   capflow_inv_items     — catalog of inventory items (raw materials + finished products)
//   capflow_inv_movements — full audit trail of every stock change
//
// NOTE: This store is the single source of truth for all stock management.
// The Sales module must exclusively use InventoryAPI.removeStock(itemId, quantity, saleId, note?)
// to deduct stock when a sale is saved. No other inventory API exists.
//
// Item schema:
//   id, name, type ('raw_material'|'finished_product'), stock, unit,
//   createdAt (number), updatedAt (number)
//
// Movement schema:
//   id, itemId, type ('in'|'out'|'adjustment'),
//   quantity (signed: positive = increase, negative = decrease for adjustments),
//   date (number), referenceId?, note?
//
// Rules enforced at the API layer:
//   • 'in'         → stock += quantity    (quantity must be > 0)
//   • 'out'        → stock -= quantity    (quantity must be > 0; rejects if result < 0)
//   • 'adjustment' → stock += quantity    (quantity is signed; rejects if result < 0)
//   • updatedAt is refreshed on every stock mutation
//   • Items are never hard-deleted (updateItem can deactivate; no remove method)
//
// Sales integration hook:
//   InventoryAPI.removeStock(itemId, quantity, saleId, note?)
//   The Sales module will pass saleId as referenceId when a sale is saved.
// =============================================================================

// ─── Item store helpers ───────────────────────────────────────────────────────

const STORAGE_KEY_INV_ITEMS = 'capflow_inv_items';

const _invItemStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_INV_ITEMS)) || []; }
    catch { return []; }
  },
  write(records) { localStorage.setItem(STORAGE_KEY_INV_ITEMS, JSON.stringify(records)); },
  generateId()   { return `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

// ─── Movement store helpers ───────────────────────────────────────────────────

const STORAGE_KEY_INV_MOVEMENTS = 'capflow_inv_movements';

const _invMovementStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_INV_MOVEMENTS)) || []; }
    catch { return []; }
  },
  write(records) { localStorage.setItem(STORAGE_KEY_INV_MOVEMENTS, JSON.stringify(records)); },
  generateId()   { return `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

// ─── Private helper: write a movement entry ───────────────────────────────────

/**
 * Append a movement record to the movements collection.
 * Used internally by addStock, removeStock, and adjustStock.
 *
 * @param {string} itemId
 * @param {'in'|'out'|'adjustment'} type
 * @param {number} quantity  - Signed. Positive = increase, negative = decrease.
 * @param {string|null} referenceId
 * @param {string} note
 * @returns {Object}  The persisted movement record
 */
function _writeMovement(itemId, type, quantity, referenceId, note) {
  const movements = _invMovementStore.read();
  const entry = {
    id:          _invMovementStore.generateId(),
    itemId:      String(itemId),
    type,
    quantity,                              // signed; sign is informational for adjustments
    date:        Date.now(),
    referenceId: referenceId ?? null,
    note:        (note || '').trim(),
  };
  movements.push(entry);
  _invMovementStore.write(movements);
  return entry;
}

/**
 * LocalInventoryStore — localStorage adapter for the inventory module.
 *
 * All methods return Promises so inventory.js is agnostic about storage.
 * Flip USE_LOCAL_STORE in this file to switch the entire data layer.
 */
const LocalInventoryStore = {
  // ── Item CRUD ──────────────────────────────────────────────────────────────

  /**
   * Return all inventory items.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_invItemStore.read());
  },

  /**
   * Return a single item by id, or null if not found.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  getById(id) {
    const found = _invItemStore.read().find(r => String(r.id) === String(id));
    return Promise.resolve(found ?? null);
  },

  /**
   * Create a new inventory item with zero initial stock.
   * Stock is only modified through addStock / removeStock / adjustStock.
   * @param {Object} data  - { name, type, unit }
   * @returns {Promise<Object>}  The newly created item
   */
  createItem(data) {
    const items = _invItemStore.read();
    const now   = Date.now();

    const item = {
      id:        _invItemStore.generateId(),
      name:      (data.name || '').trim(),
      type:      data.type  || 'finished_product',
      unit:      (data.unit || '').trim(),
      stock:     0,
      createdAt: now,
      updatedAt: now,
    };

    items.push(item);
    _invItemStore.write(items);
    return Promise.resolve(item);
  },

  /**
   * Update the name, type, or unit of an existing item.
   * Stock is intentionally excluded — use addStock / removeStock / adjustStock.
   * @param {string} id
   * @param {Object} data  - { name?, type?, unit? }
   * @returns {Promise<Object>}  The updated item
   */
  updateItem(id, data) {
    const items = _invItemStore.read();
    const index = items.findIndex(r => String(r.id) === String(id));

    if (index === -1) {
      return Promise.reject(new Error(`Artículo con id "${id}" no encontrado.`));
    }

    const prev    = items[index];
    const updated = {
      id:        prev.id,
      createdAt: prev.createdAt,
      stock:     prev.stock,             // immutable via this method
      name:      data.name !== undefined ? (data.name || '').trim() : prev.name,
      type:      data.type !== undefined ? (data.type || prev.type)  : prev.type,
      unit:      data.unit !== undefined ? (data.unit || '').trim()  : prev.unit,
      updatedAt: Date.now(),
    };

    items[index] = updated;
    _invItemStore.write(items);
    return Promise.resolve(updated);
  },

  // ── Stock Operations ───────────────────────────────────────────────────────

  /**
   * Increase stock for an item.
   * Creates an 'in' movement record.
   *
   * @param {string} itemId
   * @param {number} quantity  - Must be > 0
   * @param {string} [note]
   * @returns {Promise<Object>}  The updated item
   */
  /**
   * @param {string} itemId
   * @param {number} quantity     - Must be > 0
   * @param {string} [referenceId] - Optional; links movement to a production record or sale
   * @param {string} [note]
   */
  addStock(itemId, quantity, referenceId = null, note = '') {
    const items = _invItemStore.read();
    const index = items.findIndex(r => String(r.id) === String(itemId));

    if (index === -1) {
      return Promise.reject(new Error(`Artículo con id "${itemId}" no encontrado.`));
    }

    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      return Promise.reject(new Error('La cantidad debe ser mayor que cero.'));
    }

    const updated = { ...items[index], stock: items[index].stock + qty, updatedAt: Date.now() };
    items[index] = updated;
    _invItemStore.write(items);
    _writeMovement(itemId, 'in', qty, referenceId, note);

    return Promise.resolve(updated);
  },

  /**
   * Decrease stock for an item.
   * Creates an 'out' movement record.
   * Rejects if quantity > current stock.
   *
   * Sales integration hook: pass saleId as referenceId.
   * The Sales module will call: InventoryAPI.removeStock(itemId, qty, saleId, note?)
   *
   * @param {string} itemId
   * @param {number} quantity    - Must be > 0 and ≤ current stock
   * @param {string} [referenceId] - Optional; will hold saleId when Sales calls this
   * @param {string} [note]
   * @returns {Promise<Object>}  The updated item
   */
  removeStock(itemId, quantity, referenceId = null, note = '') {
    const items = _invItemStore.read();
    const index = items.findIndex(r => String(r.id) === String(itemId));

    if (index === -1) {
      return Promise.reject(new Error(`Artículo con id "${itemId}" no encontrado.`));
    }

    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      return Promise.reject(new Error('La cantidad debe ser mayor que cero.'));
    }

    if (qty > items[index].stock) {
      return Promise.reject(new Error(
        `Stock insuficiente. Disponible: ${items[index].stock}, requerido: ${qty}.`
      ));
    }

    const updated = { ...items[index], stock: items[index].stock - qty, updatedAt: Date.now() };
    items[index] = updated;
    _invItemStore.write(items);
    _writeMovement(itemId, 'out', -qty, referenceId, note);  // stored negative for clarity

    return Promise.resolve(updated);
  },

  /**
   * Apply a signed stock adjustment.
   * Creates an 'adjustment' movement record.
   * Rejects if the result would go below zero.
   *
   * Positive quantity = stock increase (correction upward).
   * Negative quantity = stock decrease (correction downward).
   *
   * @param {string} itemId
   * @param {number} quantity  - Signed integer (positive or negative, not zero)
   * @param {string} [note]
   * @returns {Promise<Object>}  The updated item
   */
  adjustStock(itemId, quantity, note = '') {
    const items = _invItemStore.read();
    const index = items.findIndex(r => String(r.id) === String(itemId));

    if (index === -1) {
      return Promise.reject(new Error(`Artículo con id "${itemId}" no encontrado.`));
    }

    const qty = Number(quantity);
    if (qty === 0 || isNaN(qty)) {
      return Promise.reject(new Error('La cantidad de ajuste no puede ser cero.'));
    }

    const newStock = items[index].stock + qty;
    if (newStock < 0) {
      return Promise.reject(new Error(
        `Ajuste inválido. Stock actual: ${items[index].stock}, ajuste: ${qty}, resultado: ${newStock}.`
      ));
    }

    const updated = { ...items[index], stock: newStock, updatedAt: Date.now() };
    items[index] = updated;
    _invItemStore.write(items);
    _writeMovement(itemId, 'adjustment', qty, null, note);

    return Promise.resolve(updated);
  },

  // ── Movement History ───────────────────────────────────────────────────────

  /**
   * Return movement records, optionally filtered by itemId.
   * Always returned in reverse-chronological order (newest first).
   *
   * @param {string} [itemId]  - If omitted, returns all movements
   * @returns {Promise<Array>}
   */
  getMovements(itemId) {
    let movements = _invMovementStore.read();
    if (itemId !== undefined && itemId !== null) {
      movements = movements.filter(m => String(m.itemId) === String(itemId));
    }
    return Promise.resolve([...movements].reverse());
  },
};

// =============================================================================
// INVENTORY — REST API Adapter (Production Phase)
// =============================================================================

const RestInventoryStore = {
  getAll:      ()                               => _request('/inventory/items'),
  getById:     (id)                             => _request(`/inventory/items/${id}`),
  createItem:  (data)                           => _request('/inventory/items',                        { method: 'POST',  body: data }),
  updateItem:  (id, data)                       => _request(`/inventory/items/${id}`,                  { method: 'PUT',   body: data }),
  addStock:    (itemId, quantity, referenceId, note) => _request(`/inventory/items/${itemId}/add`,     { method: 'POST',  body: { quantity, referenceId, note } }),
  removeStock: (itemId, quantity, referenceId, note) =>
                                                   _request(`/inventory/items/${itemId}/remove`,       { method: 'POST',  body: { quantity, referenceId, note } }),
  adjustStock: (itemId, quantity, note)         => _request(`/inventory/items/${itemId}/adjust`,       { method: 'POST',  body: { quantity, note } }),
  getMovements:(itemId)                         => _request(itemId
                                                   ? `/inventory/movements?itemId=${itemId}`
                                                   : '/inventory/movements'),
};

// =============================================================================
// INVENTORY EXPORT — Single switchable interface
// =============================================================================

/**
 * InventoryAPI — imported by inventory.js.
 * removeStock(itemId, quantity, referenceId?, note?) is the hook that the
 * Sales module will call when a sale is saved:
 *   InventoryAPI.removeStock(itemId, qty, saleId, note?)
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const InventoryAPI = USE_LOCAL_STORE ? LocalInventoryStore : RestInventoryStore;

// =============================================================================
// PRODUCT → INVENTORY LINK HELPERS
//
// These two helpers are the ONLY sanctioned way to resolve or create the
// inventory item that corresponds to a Product or a raw material type.
// Calling them is idempotent — they never create duplicate inventory items.
// =============================================================================

/**
 * Resolve (and create if absent) the Inventory item that corresponds to a
 * manufactured product.
 *
 * Algorithm:
 *   1. If product.inventoryItemId is set and InventoryAPI can find the item,
 *      return the existing inventoryItemId immediately.
 *   2. Otherwise create a new Inventory item (type: 'finished_product',
 *      unit: 'paquetes', stock: 0), then write the new id back onto the
 *      Product record via ProductsAPI.update() so the link is permanent.
 *
 * Safe to call multiple times — never produces duplicates.
 *
 * @param {Object} product  - A product record returned by ProductsAPI
 * @returns {Promise<string>}  The inventoryItemId for this product
 */
export async function ensureProductInventoryItem(product) {
  // ── Step 1: check existing link ───────────────────────────────────────────
  if (product.inventoryItemId) {
    const existing = await InventoryAPI.getById(product.inventoryItemId);
    if (existing) return product.inventoryItemId;
  }

  // ── Step 2: create inventory item ─────────────────────────────────────────
  const newItem = await InventoryAPI.createItem({
    name: product.name,
    type: 'finished_product',
    unit: 'paquetes',
  });

  // ── Step 3: persist the link on the product record ────────────────────────
  // ProductsAPI.update() preserves all other fields; only inventoryItemId changes.
  await ProductsAPI.update(product.id, { inventoryItemId: newItem.id });

  return newItem.id;
}

// =============================================================================
// EMPLOYEES — localStorage Adapter (Prototype Phase)
//
// Tracks salaried/hourly employees who appear on the Payroll (Nómina) module.
// No hard deletes — employees are deactivated instead.
//
// Schema:
//   id           string   — unique record id
//   name         string   — full name
//   document     string?  — national ID / cédula
//   phone        string?
//   email        string?
//   position     string?  — job title / position
//   monthlySalary number  — gross monthly salary (RD$)
//   isActive     boolean
//   createdAt    string   — ISO timestamp, set once on create
//   updatedAt    string?  — ISO timestamp, updated on every write
// =============================================================================

const STORAGE_KEY_EMPLOYEES = 'capflow_employees';

const _employeeStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_EMPLOYEES)) || []; }
    catch { return []; }
  },
  write(records) { localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(records)); },
  generateId()   { return `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

/**
 * LocalEmployeesStore — localStorage adapter for employees.
 * All methods return Promises so payroll.js is agnostic about storage.
 */
const LocalEmployeesStore = {
  /**
   * Return all employee records from localStorage.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_employeeStore.read());
  },

  /**
   * Create a new employee record.
   * Assigns `id`, `isActive: true`, and `createdAt` automatically.
   * @param {Object} data  - { name, document?, phone?, email?, position?, monthlySalary }
   * @returns {Promise<Object>}  The persisted employee with its new id
   */
  create(data) {
    const records    = _employeeStore.read();
    const newRecord  = {
      ...data,
      id:            _employeeStore.generateId(),
      monthlySalary: Number(data.monthlySalary) || 0,
      isActive:      true,
      createdAt:     new Date().toISOString(),
    };
    records.push(newRecord);
    _employeeStore.write(records);
    return Promise.resolve(newRecord);
  },

  /**
   * Update an existing employee's fields.
   * `id` and `createdAt` are always preserved.
   * @param {string} id
   * @param {Object} data  - Fields to update
   * @returns {Promise<Object>}  The updated employee
   */
  update(id, data) {
    const records = _employeeStore.read();
    const index   = records.findIndex(r => String(r.id) === String(id));
    if (index === -1) {
      return Promise.reject(new Error(`Empleado con id "${id}" no encontrado.`));
    }
    const updated = {
      ...records[index],
      ...data,
      id:            records[index].id,
      createdAt:     records[index].createdAt,
      monthlySalary: data.monthlySalary !== undefined
        ? Number(data.monthlySalary) : records[index].monthlySalary,
      updatedAt:     new Date().toISOString(),
    };
    records[index] = updated;
    _employeeStore.write(records);
    return Promise.resolve(updated);
  },

  /**
   * Deactivate an employee (set isActive = false).
   * Employees are never permanently deleted.
   * @param {string} id
   * @returns {Promise<Object>}  The updated employee
   */
  deactivate(id) {
    return LocalEmployeesStore.update(id, { isActive: false });
  },

  /**
   * Reactivate a previously deactivated employee.
   * @param {string} id
   * @returns {Promise<Object>}  The updated employee
   */
  activate(id) {
    return LocalEmployeesStore.update(id, { isActive: true });
  },
};

// =============================================================================
// EMPLOYEES — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestEmployeesStore — REST adapter for employees.
 * Identical interface to LocalEmployeesStore for zero-friction swap.
 */
const RestEmployeesStore = {
  getAll:     ()         => _request('/employees'),
  create:     (data)     => _request('/employees',                 { method: 'POST', body: data }),
  update:     (id, data) => _request(`/employees/${id}`,           { method: 'PUT',  body: data }),
  deactivate: (id)       => _request(`/employees/${id}/deactivate`, { method: 'PUT' }),
  activate:   (id)       => _request(`/employees/${id}/activate`,   { method: 'PUT' }),
};

// =============================================================================
// EMPLOYEES EXPORT
// =============================================================================

/**
 * EmployeesAPI — imported by payroll.js (and any other module needing employees).
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const EmployeesAPI = USE_LOCAL_STORE ? LocalEmployeesStore : RestEmployeesStore;

// =============================================================================
// LOANS — localStorage Adapter (Prototype Phase)
//
// Tracks employee / operator salary loans.  A single loan record stores the
// full repayment history so nothing can be silently erased.
//
// personKey examples: "employee:<id>" | "operator:<id>"
//
// Loan schema:
//   id          string
//   personKey   string   — "employee:<id>" | "operator:<id>"
//   principal   number   — original loan amount
//   remaining   number   — outstanding balance; never < 0
//   installment number   — standard monthly deduction amount
//   startMonth  string   — "YYYY-MM"
//   isActive    boolean
//   createdAt   string   — ISO timestamp
//   updatedAt   string?
//   history     Array    — payment entries:
//     { id, dateISO, month:"YYYY-MM", amount:number, referenceId:string, note?:string }
//
// Rules enforced at this layer:
//   • remaining never goes below 0
//   • addPayment rejects if amount <= 0 or amount > remaining
//   • revertPaymentsByReference removes matched entries and restores remaining
// =============================================================================

const STORAGE_KEY_LOANS = 'capflow_loans';

const _loanStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LOANS)) || []; }
    catch { return []; }
  },
  write(records) { localStorage.setItem(STORAGE_KEY_LOANS, JSON.stringify(records)); },
  generateId()   { return `loan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
  generateEntryId() { return `lpay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

/**
 * Normalize a month string to zero-padded "YYYY-MM".
 * Prevents duplicate records caused by "2025-1" vs "2025-01" variants.
 * @param {string} month
 * @returns {string}
 */
function _normalizeMonth(month) {
  if (!month) return '';
  const [y, m] = String(month).split('-');
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * LocalLoansStore — localStorage adapter for salary loans.
 * All methods return Promises so payroll.js is agnostic about storage.
 */
const LocalLoansStore = {
  /**
   * Return all loan records from localStorage.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_loanStore.read());
  },

  /**
   * Return loans for a specific personKey.
   * Convenience filter — equivalent to getAll().then(loans => loans.filter(...)).
   * @param {string} personKey
   * @returns {Promise<Array>}
   */
  getByPersonKey(personKey) {
    const records = _loanStore.read().filter(r => r.personKey === String(personKey));
    return Promise.resolve(records);
  },

  /**
   * Create a new loan record.
   * `remaining` is initialised to `principal`.
   * @param {Object} data  - { personKey, principal, installment, startMonth, note? }
   * @returns {Promise<Object>}
   */
  create(data) {
    const records   = _loanStore.read();
    const principal = Number(data.principal) || 0;
    const newRecord = {
      ...data,
      id:          _loanStore.generateId(),
      personKey:   String(data.personKey || ''),
      principal,
      remaining:   principal,
      installment: Number(data.installment) || 0,
      startMonth:  _normalizeMonth(data.startMonth),
      isActive:    true,
      history:     [],
      createdAt:   new Date().toISOString(),
    };
    records.push(newRecord);
    _loanStore.write(records);
    return Promise.resolve(newRecord);
  },

  /**
   * Update editable loan fields (principal, installment, startMonth, note).
   * Does NOT allow editing history or remaining directly.
   * `id`, `createdAt`, `history`, and `remaining` are always preserved.
   * @param {string} id
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  update(id, data) {
    const records = _loanStore.read();
    const index   = records.findIndex(r => String(r.id) === String(id));
    if (index === -1) {
      return Promise.reject(new Error(`Préstamo con id "${id}" no encontrado.`));
    }
    // Strip fields callers must not overwrite
    const { id: _id, createdAt: _ca, history: _h, remaining: _r, ...safe } = data;
    const updated = {
      ...records[index],
      ...safe,
      principal:   safe.principal  !== undefined ? Number(safe.principal)  : records[index].principal,
      installment: safe.installment !== undefined ? Number(safe.installment) : records[index].installment,
      startMonth:  safe.startMonth  !== undefined ? _normalizeMonth(safe.startMonth) : records[index].startMonth,
      id:          records[index].id,
      createdAt:   records[index].createdAt,
      history:     records[index].history,
      remaining:   records[index].remaining,
      updatedAt:   new Date().toISOString(),
    };
    records[index] = updated;
    _loanStore.write(records);
    return Promise.resolve(updated);
  },

  /**
   * Deactivate a loan (set isActive = false).
   * Loans are never permanently deleted.
   * @param {string} id
   * @returns {Promise<Object>}
   */
  deactivate(id) {
    return LocalLoansStore.update(id, { isActive: false });
  },

  /**
   * Reactivate a previously deactivated loan.
   * @param {string} id
   * @returns {Promise<Object>}
   */
  activate(id) {
    return LocalLoansStore.update(id, { isActive: true });
  },

  /**
   * Record a loan payment.
   * Reduces `remaining` by `amount` and appends a history entry.
   *
   * Rejects if:
   *   • loan not found
   *   • amount <= 0
   *   • amount > remaining (debt cannot go negative)
   *
   * @param {string} loanId
   * @param {Object} payment  - { month, amount, referenceId, note? }
   * @returns {Promise<Object>}  The updated loan record
   */
  addPayment(loanId, { month, amount, referenceId, note = '' }) {
    const records = _loanStore.read();
    const index   = records.findIndex(r => String(r.id) === String(loanId));
    if (index === -1) {
      return Promise.reject(new Error(`Préstamo con id "${loanId}" no encontrado.`));
    }

    const loan = records[index];
    const amt  = Number(amount);

    if (!amt || amt <= 0) {
      return Promise.reject(new Error('El monto del pago debe ser mayor que cero.'));
    }
    if (amt > loan.remaining) {
      return Promise.reject(new Error(
        `El pago (${amt.toFixed(2)}) supera el saldo restante (${loan.remaining.toFixed(2)}).`
      ));
    }

    const entry = {
      id:          _loanStore.generateEntryId(),
      dateISO:     new Date().toISOString(),
      month:       _normalizeMonth(month),
      amount:      amt,
      referenceId: String(referenceId || ''),
      note:        (note || '').trim(),
    };

    const updated = {
      ...loan,
      remaining:  Math.max(0, loan.remaining - amt),
      history:    [...(loan.history || []), entry],
      updatedAt:  new Date().toISOString(),
    };

    // Auto-deactivate when fully repaid
    if (updated.remaining === 0) updated.isActive = false;

    records[index] = updated;
    _loanStore.write(records);
    return Promise.resolve(updated);
  },

  /**
   * Revert all payment history entries that match a given referenceId.
   *
   * For each matched entry the payment amount is added back to `remaining`,
   * and the entry is removed from history.  This keeps the loan auditable:
   * a companion payroll deletion will create its own audit trail; the loan
   * simply returns to its pre-payment state.
   *
   * Rejects if the loan is not found.
   * Is a no-op (resolves successfully) if no entries match.
   *
   * @param {string} referenceId
   * @returns {Promise<Object>}  The updated loan record (or unchanged if no match)
   */
  revertPaymentsByReference(referenceId) {
    const records = _loanStore.read();
    const refStr  = String(referenceId || '');

    // Find every loan that has at least one entry for this referenceId
    let anyUpdated = false;

    const updatedRecords = records.map(loan => {
      const matching   = (loan.history || []).filter(e => e.referenceId === refStr);
      if (!matching.length) return loan;

      const totalReverted = matching.reduce((s, e) => s + e.amount, 0);
      const newHistory    = (loan.history || []).filter(e => e.referenceId !== refStr);
      const newRemaining  = loan.remaining + totalReverted;

      anyUpdated = true;
      return {
        ...loan,
        remaining: newRemaining,
        // Re-activate if it was auto-deactivated on full repayment
        isActive:  newRemaining > 0 ? true : loan.isActive,
        history:   newHistory,
        updatedAt: new Date().toISOString(),
      };
    });

    _loanStore.write(updatedRecords);
    // Return the first updated loan, or the first record, for caller convenience
    const updated = updatedRecords.find(
      r => (r.history || []).every(e => e.referenceId !== refStr) &&
           records.find(orig => orig.id === r.id)?.history?.some(e => e.referenceId === refStr)
    );
    return Promise.resolve(updated ?? updatedRecords[0] ?? null);
  },
};

// =============================================================================
// LOANS — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestLoansStore — REST adapter for loans.
 * Identical interface to LocalLoansStore for zero-friction swap.
 */
const RestLoansStore = {
  getAll:                  ()                     => _request('/loans'),
  getByPersonKey:          (personKey)            => _request(`/loans?personKey=${encodeURIComponent(personKey)}`),
  create:                  (data)                 => _request('/loans',                               { method: 'POST',   body: data }),
  update:                  (id, data)             => _request(`/loans/${id}`,                         { method: 'PUT',    body: data }),
  deactivate:              (id)                   => _request(`/loans/${id}/deactivate`,              { method: 'PUT' }),
  activate:                (id)                   => _request(`/loans/${id}/activate`,                { method: 'PUT' }),
  addPayment:              (loanId, payment)      => _request(`/loans/${loanId}/payments`,            { method: 'POST',   body: payment }),
  revertPaymentsByReference: (referenceId)        => _request(`/loans/payments/revert/${encodeURIComponent(referenceId)}`, { method: 'DELETE' }),
};

// =============================================================================
// LOANS EXPORT
// =============================================================================

/**
 * LoansAPI — imported by payroll.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const LoansAPI = USE_LOCAL_STORE ? LocalLoansStore : RestLoansStore;

// =============================================================================
// PAYROLL — localStorage Adapter (Prototype Phase)
//
// Stores up to TWO payroll run snapshots per month — one per quincenal period.
//
// Invariant: one record per periodKey ("YYYY-MM-Q1" | "YYYY-MM-Q2").
//
// Snapshot schema:
//   id              string   — unique record id
//   month           string   — "YYYY-MM" (zero-padded)
//   period          1 | 2    — pay period within the month
//   periodKey       string   — "YYYY-MM-Q1" | "YYYY-MM-Q2" (canonical lookup key)
//   isClosed        boolean
//   createdAt       string   — ISO, set once on first create
//   closedAt        string?  — ISO, set when isClosed = true
//   loanReferenceId string   — "payroll:<id>" unique per run; used to revert loans
//   totals          object   — { gross, bonuses, deductions, loans, net }
//   rows            Array    — per-person snapshot rows
//
// Migration: legacy records without a period field are transparently migrated
// to period=2 / periodKey="YYYY-MM-Q2" on the first read.
// =============================================================================

const STORAGE_KEY_PAYROLL = 'capflow_payroll_runs';

const _payrollStore = {
  /** Read records, migrating any legacy (no-period) entries to period=2. */
  read() {
    let records;
    try { records = JSON.parse(localStorage.getItem(STORAGE_KEY_PAYROLL)) || []; }
    catch { records = []; }

    // Migration pass — runs once in O(n) and writes back only if needed
    let dirty = false;
    records = records.map(r => {
      if (r.periodKey) return r;                       // already migrated
      dirty = true;
      const month     = _normalizeMonth(r.month || '2000-01');
      const periodKey = `${month}-Q2`;                 // legacy → Q2 by convention
      return { ...r, month, period: 2, periodKey };
    });
    if (dirty) this.write(records);

    return records;
  },
  write(records) { localStorage.setItem(STORAGE_KEY_PAYROLL, JSON.stringify(records)); },
  generateId()   { return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; },
};

/** Build a canonical "YYYY-MM-Q1" or "YYYY-MM-Q2" string. */
function _normalizePeriodKey(month, period) {
  return `${_normalizeMonth(month)}-Q${period === 1 ? 1 : 2}`;
}

/**
 * LocalPayrollStore — period-aware localStorage adapter for payroll run snapshots.
 * Up to two records per month (one per quincenal period).
 * All methods return Promises so payroll.js is agnostic about storage.
 */
const LocalPayrollStore = {
  /**
   * Return all payroll run records from localStorage.
   * @returns {Promise<Array>}
   */
  getAll() {
    return Promise.resolve(_payrollStore.read());
  },

  /**
   * Return the payroll run for a specific month + period, or null.
   * @param {string} month   - "YYYY-MM"
   * @param {1|2}    period
   * @returns {Promise<Object|null>}
   */
  getByPeriod(month, period) {
    const pk     = _normalizePeriodKey(month, period);
    const record = _payrollStore.read().find(r => r.periodKey === pk) ?? null;
    return Promise.resolve(record);
  },

  /**
   * Create or replace the payroll run for a specific month + period.
   *
   * • New: creates with fresh id and createdAt.
   * • Existing: replaces in full, preserving id and createdAt.
   *
   * @param {string} month
   * @param {1|2}    period
   * @param {Object} snapshot - Full snapshot payload (id/createdAt added here)
   * @returns {Promise<Object>}
   */
  upsertByPeriod(month, period, snapshot) {
    const nm      = _normalizeMonth(month);
    const pk      = _normalizePeriodKey(month, period);
    const records = _payrollStore.read();
    const index   = records.findIndex(r => r.periodKey === pk);

    if (index === -1) {
      const newRecord = {
        ...snapshot,
        id:        _payrollStore.generateId(),
        month:     nm,
        period:    period === 1 ? 1 : 2,
        periodKey: pk,
        createdAt: new Date().toISOString(),
      };
      records.push(newRecord);
      _payrollStore.write(records);
      return Promise.resolve(newRecord);
    }

    const replaced = {
      ...snapshot,
      id:        records[index].id,
      month:     nm,
      period:    period === 1 ? 1 : 2,
      periodKey: pk,
      createdAt: records[index].createdAt,
      updatedAt: new Date().toISOString(),
    };
    records[index] = replaced;
    _payrollStore.write(records);
    return Promise.resolve(replaced);
  },

  /**
   * Remove the payroll run for a specific month + period.
   * No-op (resolves null) if no matching record exists.
   * @param {string} month
   * @param {1|2}    period
   * @returns {Promise<null>}
   */
  removeByPeriod(month, period) {
    const pk      = _normalizePeriodKey(month, period);
    const records = _payrollStore.read().filter(r => r.periodKey !== pk);
    _payrollStore.write(records);
    return Promise.resolve(null);
  },

  // ── Backwards-compatibility shims (keep old callers working) ──────────────

  /** @deprecated Use getByPeriod(month, 2) */
  getByMonth(month) {
    return this.getByPeriod(month, 2);
  },
  /** @deprecated Use upsertByPeriod(month, 2, snapshot) */
  upsertByMonth(month, snapshot) {
    return this.upsertByPeriod(month, 2, snapshot);
  },
  /** @deprecated Use removeByPeriod(month, 2) */
  removeByMonth(month) {
    return this.removeByPeriod(month, 2);
  },
};

// =============================================================================
// PAYROLL — REST API Adapter (Production Phase)
// =============================================================================

/**
 * RestPayrollStore — REST adapter for payroll runs.
 * Identical interface to LocalPayrollStore for zero-friction swap.
 */
const RestPayrollStore = {
  getAll:          ()                         => _request('/payroll'),
  getByPeriod:     (month, period)            => _request(`/payroll/${month}/${period}`),
  upsertByPeriod:  (month, period, snapshot)  => _request(`/payroll/${month}/${period}`,  { method: 'PUT',    body: snapshot }),
  removeByPeriod:  (month, period)            => _request(`/payroll/${month}/${period}`,  { method: 'DELETE' }),
  // backwards-compat shims
  getByMonth:      (month)                    => _request(`/payroll/${month}/2`),
  upsertByMonth:   (month, snapshot)          => _request(`/payroll/${month}/2`,           { method: 'PUT',    body: snapshot }),
  removeByMonth:   (month)                    => _request(`/payroll/${month}/2`,            { method: 'DELETE' }),
};

// =============================================================================
// PAYROLL EXPORT
// =============================================================================

/**
 * PayrollAPI — imported by payroll.js.
 * Controlled by the same USE_LOCAL_STORE flag as all other APIs.
 */
export const PayrollAPI = USE_LOCAL_STORE ? LocalPayrollStore : RestPayrollStore;

// =============================================================================
// END — Payroll / Loans / Employees additions
// =============================================================================

/**
 * Resolve (and create if absent) the Inventory raw-material item for a given
 * raw material type ('recycled' | 'pellet').
 *
 * A small mapping object is persisted in localStorage under
 * 'capflow_rm_inv_map' so the two sentinel items can be found instantly on
 * every subsequent call without scanning the full inventory list.
 *
 * Item specs:
 *   recycled → name: 'Materia prima reciclada', unit: 'lbs'
 *   pellet   → name: 'Materia prima pellet',    unit: 'lbs'
 *
 * Safe to call multiple times — never produces duplicates.
 *
 * @param {'recycled'|'pellet'} materialType
 * @returns {Promise<string>}  The inventoryItemId for this raw material type
 */
export async function ensureRawMaterialInventoryItem(materialType) {
  const STORAGE_KEY_RM_MAP = 'capflow_rm_inv_map';

  // Read the persisted map (or start fresh)
  let map = {};
  try { map = JSON.parse(localStorage.getItem(STORAGE_KEY_RM_MAP)) || {}; }
  catch { map = {}; }

  // ── Check existing entry ──────────────────────────────────────────────────
  if (map[materialType]) {
    const existing = await InventoryAPI.getById(map[materialType]);
    if (existing) return map[materialType];
    // Item was deleted from inventory — fall through to re-create
  }

  // ── Create the sentinel item ──────────────────────────────────────────────
  const names = {
    recycled: 'Materia prima reciclada',
    pellet:   'Materia prima pellet',
  };

  const newItem = await InventoryAPI.createItem({
    name: names[materialType] ?? `Materia prima (${materialType})`,
    type: 'raw_material',
    unit: 'lbs',
  });

  // ── Persist updated map ───────────────────────────────────────────────────
  map[materialType] = newItem.id;
  localStorage.setItem(STORAGE_KEY_RM_MAP, JSON.stringify(map));

  return newItem.id;
}