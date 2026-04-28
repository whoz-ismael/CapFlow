/**
 * api.js — CapFlow Data Layer (Supabase)
 *
 * All adapters expose the same async interface used by the module layer.
 * Supabase JS client is loaded via CDN in index.html (window.supabase).
 *
 * DB uses snake_case columns; JS modules use camelCase.
 * Each entity has fromDb / toDb helpers to translate between the two.
 *
 * Tables with an `extra` jsonb column (operators, employees, production,
 * raw_materials) pack/unpack overflow fields transparently.
 */

// ─── Supabase Client ─────────────────────────────────────────────────────────

const SUPABASE_URL      = 'https://cyzrxztodzivbxrivkot.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5enJ4enRvZHppdmJ4cml2a290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NjgwODAsImV4cCI6MjA4NzM0NDA4MH0.Ij3BFNwQiMYNVeBOYJ8T5knswO2pJWOp6Z51IiJ3mYg';

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/** Generate a collision-resistant text id: optional prefix + timestamp + random. */
function _genId(prefix = '') {
  const ts   = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return prefix ? `${prefix}-${ts}-${rand}` : `${ts}-${rand}`;
}

/** Normalize a month string to zero-padded "YYYY-MM". */
function _normalizeMonth(month) {
  if (!month) return '';
  const [y, m] = String(month).split('-');
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Same as _normalizeMonth — alias used by MonthlyInventory for clarity. */
function _normalizeApiMonth(month) { return _normalizeMonth(month); }

/** Build canonical "YYYY-MM-Q1" or "YYYY-MM-Q2" period key. */
function _normalizePeriodKey(month, period) {
  return `${_normalizeMonth(month)}-Q${period === 1 ? 1 : 2}`;
}


// =============================================================================
// PRODUCTS
//
// DB: id, name, type, active (bool), inventory_item_id, created_at, updated_at
// JS: id, name, type, active (bool), inventoryItemId,  createdAt,  updatedAt
// =============================================================================

function _productFromDb(r) {
  return {
    id:              r.id,
    name:            r.name,
    type:            r.type === 'produced' ? 'manufactured' : (r.type || 'manufactured'),
    active:          r.active !== false,
    inventoryItemId: r.inventory_item_id || null,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

export const ProductsAPI = {
  async getAll() {
    const { data, error } = await _sb.from('products').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_productFromDb);
  },

  async getById(id) {
    const { data, error } = await _sb.from('products').select('*')
      .eq('id', String(id)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _productFromDb(data) : null;
  },

  async create(d) {
    const row = {
      id:         _genId(),
      name:       (d.name || '').trim(),
      type:       d.type === 'produced' ? 'manufactured' : (d.type || 'manufactured'),
      active:     d.active !== false,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await _sb.from('products').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _productFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: new Date().toISOString() };
    if (d.name   !== undefined) u.name   = (d.name || '').trim();
    if (d.type   !== undefined) u.type   = d.type === 'produced' ? 'manufactured' : (d.type || 'manufactured');
    if (d.active !== undefined) u.active = Boolean(d.active);
    if (d.inventoryItemId !== undefined) u.inventory_item_id = d.inventoryItemId || null;

    const { data, error } = await _sb.from('products').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _productFromDb(data);
  },

  async remove(id) {
    const { error } = await _sb.from('products').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },

  async setStatus(id, active) {
    return this.update(id, { active });
  },
};


// =============================================================================
// MACHINES
//
// DB: id, name, code, notes, is_active, created_at, updated_at
// JS: id, name, code, notes, isActive,  createdAt,  updatedAt
// =============================================================================

function _machineFromDb(r) {
  return {
    id:        r.id,
    name:      r.name,
    code:      r.code,
    notes:     r.notes,
    isActive:  r.is_active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const MachinesAPI = {
  async getAll() {
    const { data, error } = await _sb.from('machines').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_machineFromDb);
  },

  async create(d) {
    const row = {
      id:         _genId(),
      name:       (d.name || '').trim(),
      code:       (d.code || '').trim(),
      notes:      (d.notes || '').trim(),
      is_active:  d.isActive !== false,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await _sb.from('machines').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _machineFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: new Date().toISOString() };
    if (d.name     !== undefined) u.name      = (d.name || '').trim();
    if (d.code     !== undefined) u.code      = (d.code || '').trim();
    if (d.notes    !== undefined) u.notes     = (d.notes || '').trim();
    if (d.isActive !== undefined) u.is_active = Boolean(d.isActive);

    const { data, error } = await _sb.from('machines').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _machineFromDb(data);
  },

  async deactivate(id) { return this.update(id, { isActive: false }); },
  async activate(id)   { return this.update(id, { isActive: true  }); },
};


// =============================================================================
// OPERATORS
//
// DB: id, name, extra (jsonb), is_active, created_at, updated_at
// JS: id, name, email, phone, document, …, isActive, createdAt, updatedAt
// Overflow fields (email, phone, document, etc.) live in the `extra` jsonb.
// =============================================================================

function _operatorFromDb(r) {
  const extra = (r.extra && typeof r.extra === 'object') ? r.extra : {};
  return {
    id:        r.id,
    name:      r.name,
    ...extra,
    isActive:  r.is_active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function _operatorToDb(d) {
  const skip = new Set(['id', 'name', 'isActive', 'createdAt', 'updatedAt', 'extra',
    'created_at', 'updated_at', 'is_active']);
  const extra = {};
  for (const [k, v] of Object.entries(d)) {
    if (!skip.has(k)) extra[k] = v;
  }
  const row = { extra };
  if (d.name     !== undefined) row.name      = (d.name || '').trim();
  if (d.isActive !== undefined) row.is_active = Boolean(d.isActive);
  return row;
}

export const OperatorsAPI = {
  async getAll() {
    const { data, error } = await _sb.from('operators').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_operatorFromDb);
  },

  async create(d) {
    const row = {
      ..._operatorToDb(d),
      id:         _genId(),
      is_active:  d.isActive !== undefined ? Boolean(d.isActive) : true,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await _sb.from('operators').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _operatorFromDb(data);
  },

  async update(id, d) {
    // Merge extra with existing to preserve unrelated fields
    const { data: raw } = await _sb.from('operators').select('extra')
      .eq('id', String(id)).single();
    const oldExtra = (raw?.extra && typeof raw.extra === 'object') ? raw.extra : {};

    const mapped = _operatorToDb(d);
    mapped.extra = { ...oldExtra, ...mapped.extra };
    mapped.updated_at = new Date().toISOString();

    const { data, error } = await _sb.from('operators').update(mapped)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _operatorFromDb(data);
  },

  async deactivate(id) { return this.update(id, { isActive: false }); },
  async activate(id)   { return this.update(id, { isActive: true  }); },
};


// =============================================================================
// PRODUCTION
//
// DB: id, product_id, operator_id, machine_id, quantity, shift,
//     production_date, month, product_price_snapshot (jsonb),
//     operator_rate_snapshot (jsonb), extra (jsonb), created_at, updated_at
// JS: id, productId, operatorId, machineId, quantity, shift,
//     productionDate, month, productPriceSnapshot, operatorRateSnapshot,
//     weightPerPackageSnapshot (in extra), createdAt, updatedAt
// =============================================================================

function _productionFromDb(r) {
  const extra = (r.extra && typeof r.extra === 'object') ? r.extra : {};
  return {
    id:                     r.id,
    productId:              r.product_id,
    operatorId:             r.operator_id,
    machineId:              r.machine_id,
    quantity:               Number(r.quantity),
    shift:                  r.shift,
    productionDate:         r.production_date,
    month:                  r.month,
    productPriceSnapshot:   r.product_price_snapshot,
    operatorRateSnapshot:   r.operator_rate_snapshot,
    ...extra,
    createdAt:              r.created_at,
    updatedAt:              r.updated_at,
  };
}

const _prodColumnKeys = new Set([
  'id', 'productId', 'operatorId', 'machineId', 'quantity', 'shift',
  'productionDate', 'month', 'productPriceSnapshot', 'operatorRateSnapshot',
  'createdAt', 'updatedAt', 'extra',
]);

function _productionToDb(d) {
  const row = {};
  if (d.productId            !== undefined) row.product_id              = d.productId;
  if (d.operatorId           !== undefined) row.operator_id             = d.operatorId;
  if (d.machineId            !== undefined) row.machine_id              = d.machineId;
  if (d.quantity             !== undefined) row.quantity                 = Number(d.quantity);
  if (d.shift                !== undefined) row.shift                   = d.shift;
  if (d.productionDate       !== undefined) row.production_date         = d.productionDate;
  if (d.productPriceSnapshot !== undefined) row.product_price_snapshot  = d.productPriceSnapshot;
  if (d.operatorRateSnapshot !== undefined) row.operator_rate_snapshot  = d.operatorRateSnapshot;

  row.month = d.month || (d.productionDate ? d.productionDate.slice(0, 7) : '');

  const extra = {};
  for (const [k, v] of Object.entries(d)) {
    if (!_prodColumnKeys.has(k)) extra[k] = v;
  }
  row.extra = extra;
  return row;
}

export const ProductionAPI = {
  async getAll() {
    const { data, error } = await _sb.from('production').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_productionFromDb);
  },

  async create(d) {
    const row = {
      ..._productionToDb(d),
      id:         _genId(),
      created_at: new Date().toISOString(),
    };
    const { data, error } = await _sb.from('production').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _productionFromDb(data);
  },

  async update(id, d) {
    // Protect snapshots
    const { productPriceSnapshot: _a, operatorRateSnapshot: _b,
            id: _c, createdAt: _d, ...safeData } = d;

    const { data: existing } = await _sb.from('production').select('extra')
      .eq('id', String(id)).single();
    const oldExtra = (existing?.extra && typeof existing.extra === 'object') ? existing.extra : {};

    const mapped = _productionToDb(safeData);
    mapped.extra = { ...oldExtra, ...(mapped.extra || {}) };
    mapped.updated_at = new Date().toISOString();
    delete mapped.product_price_snapshot;
    delete mapped.operator_rate_snapshot;

    const { data, error } = await _sb.from('production').update(mapped)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _productionFromDb(data);
  },

  async remove(id) {
    const { error } = await _sb.from('production').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },
};

// =============================================================================
// PACKAGE WEIGHTS
//
// Registered by CapDispatch operators: weight of a 1,000-cap reference package
// per shift. Read by CapFlow's Production module to help fill "Peso por Paquete".
//
// DB: id, weight_lbs, operator_name, shift_date, notes, created_at
// =============================================================================

export const PackageWeightsAPI = {
  async getRecent(limit = 10) {
    const { data, error } = await _sb
      .from('package_weights')
      .select('id, weight_lbs, operator_name, shift_date, notes, created_at')
      .order('shift_date',  { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },
};

// =============================================================================
// PROVIDERS
//
// DB: id, name, phone, email, address, notes, is_active, created_at, updated_at
// JS: id, name, phone, email, address, notes, isActive,  createdAt,  updatedAt
// =============================================================================

function _providerFromDb(r) {
  return {
    id:        r.id,
    name:      r.name,
    phone:     r.phone,
    email:     r.email,
    address:   r.address,
    notes:     r.notes,
    isActive:  r.is_active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const ProvidersAPI = {
  async getAll() {
    const { data, error } = await _sb.from('providers').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_providerFromDb);
  },

  async create(d) {
    const row = {
      id:         _genId(),
      name:       (d.name || '').trim(),
      phone:      (d.phone || '').trim(),
      email:      (d.email || '').trim(),
      address:    (d.address || '').trim(),
      notes:      (d.notes || '').trim(),
      is_active:  true,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await _sb.from('providers').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _providerFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: new Date().toISOString() };
    if (d.name     !== undefined) u.name      = (d.name || '').trim();
    if (d.phone    !== undefined) u.phone     = (d.phone || '').trim();
    if (d.email    !== undefined) u.email     = (d.email || '').trim();
    if (d.address  !== undefined) u.address   = (d.address || '').trim();
    if (d.notes    !== undefined) u.notes     = (d.notes || '').trim();
    if (d.isActive !== undefined) u.is_active = Boolean(d.isActive);

    const { data, error } = await _sb.from('providers').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _providerFromDb(data);
  },

  async deactivate(id) { return this.update(id, { isActive: false }); },
  async activate(id)   { return this.update(id, { isActive: true  }); },
};


// =============================================================================
// RAW MATERIALS
//
// DB: id, type, purchase_date, month, weight_lbs, cost, washed_weight_lbs,
//     washing_cost, provider_id, notes, extra (jsonb), created_at, updated_at
// JS: id, materialType, date, month, weightLbs, totalCost, washedWeightLbs,
//     washingCost, supplierId/providerId, notes, createdAt, updatedAt
// =============================================================================

function _rawMaterialFromDb(r) {
  const extra = (r.extra && typeof r.extra === 'object') ? r.extra : {};
  return {
    id:              r.id,
    materialType:    r.type,
    type:            r.type,
    date:            r.purchase_date,
    purchaseDate:    r.purchase_date,
    month:           r.month,
    weightLbs:       Number(r.weight_lbs),
    totalCost:       Number(r.cost),
    washedWeightLbs: Number(r.washed_weight_lbs),
    washingCost:     Number(r.washing_cost),
    supplierId:      r.provider_id,
    providerId:      r.provider_id,
    notes:           r.notes,
    ...extra,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

const _rmSkipKeys = new Set([
  'id', 'materialType', 'type', 'date', 'purchaseDate', 'month',
  'weightLbs', 'totalCost', 'cost', 'washedWeightLbs', 'washingCost',
  'supplierId', 'providerId', 'notes', 'createdAt', 'updatedAt', 'extra',
]);

function _rawMaterialToDb(d) {
  const purchaseDate = d.date || d.purchaseDate || '';
  const row = {
    type:              d.materialType || d.type || '',
    purchase_date:     purchaseDate,
    month:             d.month || purchaseDate.slice(0, 7),
    weight_lbs:        Number(d.weightLbs) || 0,
    cost:              Number(d.totalCost ?? d.cost) || 0,
    washed_weight_lbs: Number(d.washedWeightLbs) || 0,
    washing_cost:      Number(d.washingCost) || 0,
    provider_id:       d.supplierId || d.providerId || '',
    notes:             d.notes || '',
  };
  const extra = {};
  for (const [k, v] of Object.entries(d)) {
    if (!_rmSkipKeys.has(k)) extra[k] = v;
  }
  row.extra = extra;
  return row;
}

export const RawMaterialsAPI = {
  async getAll() {
    const { data, error } = await _sb.from('raw_materials').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_rawMaterialFromDb);
  },

  async create(d) {
    const row = {
      ..._rawMaterialToDb(d),
      id:         _genId(),
      created_at: new Date().toISOString(),
    };
    const { data, error } = await _sb.from('raw_materials').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _rawMaterialFromDb(data);
  },

  async update(id, d) {
    const u = { ..._rawMaterialToDb(d), updated_at: new Date().toISOString() };
    const { data, error } = await _sb.from('raw_materials').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _rawMaterialFromDb(data);
  },

  async remove(id) {
    const { error } = await _sb.from('raw_materials').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },
};


// =============================================================================
// MONTHLY INVENTORY
//
// DB: id, month, recycled_closing_lbs, pellet_closing_lbs, created_at, updated_at
// JS: id, month, recycledClosingLbs,   pelletClosingLbs,   createdAt,  updatedAt
// =============================================================================

function _monthlyInvFromDb(r) {
  return {
    id:                 r.id,
    month:              _normalizeApiMonth(r.month),
    recycledClosingLbs: Number(r.recycled_closing_lbs),
    pelletClosingLbs:   Number(r.pellet_closing_lbs),
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
  };
}

export const MonthlyInventoryAPI = {
  async getAll() {
    const { data, error } = await _sb.from('monthly_inventory').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_monthlyInvFromDb);
  },

  async getByMonth(month) {
    const norm = _normalizeApiMonth(month);
    const { data, error } = await _sb.from('monthly_inventory').select('*')
      .eq('month', norm).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _monthlyInvFromDb(data) : null;
  },

  async upsert(d) {
    const norm = _normalizeApiMonth(d.month);
    const existing = await this.getByMonth(norm);

    if (existing) {
      const { data, error } = await _sb.from('monthly_inventory').update({
        recycled_closing_lbs: Number(d.recycledClosingLbs) || 0,
        pellet_closing_lbs:   Number(d.pelletClosingLbs) || 0,
        updated_at:           new Date().toISOString(),
      }).eq('id', existing.id).select().single();
      if (error) throw new Error(error.message);
      return _monthlyInvFromDb(data);
    }

    const { data, error } = await _sb.from('monthly_inventory').insert({
      id:                   _genId(),
      month:                norm,
      recycled_closing_lbs: Number(d.recycledClosingLbs) || 0,
      pellet_closing_lbs:   Number(d.pelletClosingLbs) || 0,
      created_at:           new Date().toISOString(),
    }).select().single();
    if (error) throw new Error(error.message);
    return _monthlyInvFromDb(data);
  },
};


// =============================================================================
// MATERIAL TYPE HELPERS
// =============================================================================

/**
 * Map a raw DB type value to its Spanish display label.
 * @param {string} type
 * @returns {string}
 */
export function getMaterialTypeLabel(type) {
  const labels = {
    recycled:       'Tapas usadas',
    pellet:         'Peletizado virgen',
    pellet_regular: 'Peletizado',
    colorant:       'Colorante',
  };
  return labels[type] || type;
}

/**
 * CSS badge modifier class for each material type.
 * @param {string} type
 * @returns {string}
 */
export function getMaterialTypeBadge(type) {
  const badges = {
    recycled:       'badge--teal',
    pellet:         'badge--blue',
    pellet_regular: 'badge--indigo',
    colorant:       'badge--purple',
  };
  return badges[type] || 'badge--gray';
}


// =============================================================================
// MATERIAL RECEIPTS
//
// DB: id, type, receipt_date, month, weight_lbs, notes, operator_name,
//     status, raw_material_id, created_at, updated_at
// JS: id, type, receiptDate, month, weightLbs, notes, operatorName,
//     status, rawMaterialId, createdAt, updatedAt
// =============================================================================

function _materialReceiptFromDb(r) {
  return {
    id:             r.id,
    type:           r.type,
    receiptDate:    r.receipt_date,
    date:           r.receipt_date,
    month:          r.month,
    weightLbs:      Number(r.weight_lbs),
    notes:          r.notes || '',
    operatorName:   r.operator_name || '',
    status:         r.status,
    rawMaterialId:  r.raw_material_id || null,
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  };
}

export const MaterialReceiptsAPI = {
  async getAll() {
    const { data, error } = await _sb.from('material_receipts').select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(_materialReceiptFromDb);
  },

  async getPending() {
    const { data, error } = await _sb.from('material_receipts').select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(_materialReceiptFromDb);
  },

  /**
   * Confirm a pending receipt: creates the raw_materials record and marks the
   * receipt as confirmed in a single coordinated operation.
   * @param {string} receiptId
   * @param {Object} confirmData - { date, supplierId, totalCost, washedWeightLbs, washingCost }
   * @param {Object} receipt - the original receipt object (for type, weightLbs, month)
   * @returns {Object} the newly created raw_materials record
   */
  async confirm(receiptId, confirmData, receipt) {
    // 1. Create the raw_materials record
    const rawMaterialRow = {
      id:                _genId(),
      type:              receipt.type,
      purchase_date:     confirmData.date || receipt.receiptDate,
      month:             confirmData.month || receipt.month,
      weight_lbs:        Number(receipt.weightLbs) || 0,
      cost:              Number(confirmData.totalCost) || 0,
      washed_weight_lbs: Number(confirmData.washedWeightLbs) || 0,
      washing_cost:      Number(confirmData.washingCost) || 0,
      provider_id:       confirmData.supplierId || '',
      notes:             receipt.notes || '',
      extra:             {},
      created_at:        new Date().toISOString(),
    };

    const { data: rmData, error: rmError } = await _sb
      .from('raw_materials').insert(rawMaterialRow).select().single();
    if (rmError) throw new Error(rmError.message);

    // 2. Mark the receipt as confirmed
    const { error: updateError } = await _sb
      .from('material_receipts').update({
        status:          'confirmed',
        raw_material_id: rawMaterialRow.id,
        updated_at:      new Date().toISOString(),
      }).eq('id', receiptId);
    if (updateError) throw new Error(updateError.message);

    return _rawMaterialFromDb(rmData);
  },
};


// =============================================================================
// SALES
//
// DB: id, sale_date, month, client_id, status, notes, invoice_number,
//     totals (jsonb), attachments (jsonb), lines (jsonb),
//     has_ncf, ncf_number, itbis_rate, itbis_amount,
//     created_at, updated_at
// JS: id, saleDate, month, clientId, status, notes, invoiceNumber,
//     totals, attachments, lines, investor,
//     hasNcf, ncfNumber, itbisRate, itbisAmount,
//     createdAt, updatedAt
// =============================================================================

function _saleFromDb(r) {
  const rawTotals = (r.totals && typeof r.totals === 'object')
    ? r.totals : { revenue: 0, cost: 0, profit: 0, margin: 0 };
  // Extract investor sub-object from totals if present
  const { investor: invData, ...totals } = rawTotals;
  return {
    id:            r.id,
    saleDate:      r.sale_date,
    month:         r.month || (r.sale_date || '').slice(0, 7),
    clientId:      r.client_id,
    status:        r.status || 'confirmed',
    notes:         r.notes,
    invoiceNumber: r.invoice_number,
    operatorId:    r.operator_id   || null,
    operatorName:  r.operator_name || '',
    paymentMethod: r.payment_method || 'cash',
    isInvestor:    r.is_investor   || false,
    investorId:    r.investor_id   || null,
    totals,
    attachments:   Array.isArray(r.attachments) ? r.attachments : [],
    lines:         Array.isArray(r.lines) ? r.lines : [],
    investor:      invData || null,
    hasNcf:        r.has_ncf || false,
    ncfNumber:     r.ncf_number || '',
    itbisRate:     Number(r.itbis_rate) || 0,
    itbisAmount:   Number(r.itbis_amount) || 0,
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
  };
}

export const SalesAPI = {
  async getAll() {
    const { data, error } = await _sb.from('sales').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_saleFromDb);
  },

  async getPendingReview() {
    const { data, error } = await _sb.from('sales').select('*')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(_saleFromDb);
  },

  async getById(id) {
    const { data, error } = await _sb.from('sales').select('*')
      .eq('id', String(id)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _saleFromDb(data) : null;
  },

  async create(d) {
    const saleDate = d.saleDate || '';
    const now = new Date().toISOString();
    const totalObj = d.totals || { revenue: 0, cost: 0, profit: 0, margin: 0 };
    if (d.investor) totalObj.investor = d.investor;
    const row = {
      id:             _genId('sale'),
      sale_date:      saleDate,
      month:          saleDate.slice(0, 7),
      client_id:      String(d.clientId || ''),
      status:         d.status || 'confirmed',
      notes:          (d.notes || '').trim(),
      invoice_number: (d.invoiceNumber || '').trim(),
      totals:         totalObj,
      attachments:    Array.isArray(d.attachments) ? d.attachments : [],
      lines:          Array.isArray(d.lines) ? d.lines : [],
      has_ncf:        d.hasNcf || false,
      ncf_number:     d.ncfNumber || '',
      itbis_rate:     Number(d.itbisRate) || 0,
      itbis_amount:   Number(d.itbisAmount) || 0,
      created_at:     now,
      updated_at:     now,
    };
    const { data, error } = await _sb.from('sales').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _saleFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: new Date().toISOString() };
    if (d.saleDate      !== undefined) { u.sale_date = d.saleDate; u.month = (d.saleDate || '').slice(0, 7); }
    if (d.clientId       !== undefined) u.client_id      = String(d.clientId);
    if (d.status         !== undefined) u.status         = d.status ?? 'confirmed';
    if (d.notes          !== undefined) u.notes          = (d.notes || '').trim();
    if (d.invoiceNumber  !== undefined) u.invoice_number = (d.invoiceNumber || '').trim();
    if (d.paymentMethod  !== undefined) u.payment_method = d.paymentMethod;
    if (d.attachments    !== undefined) u.attachments    = d.attachments;
    if (d.lines          !== undefined) u.lines          = d.lines;
    if (d.hasNcf         !== undefined) u.has_ncf        = d.hasNcf;
    if (d.ncfNumber      !== undefined) u.ncf_number     = d.ncfNumber;
    if (d.itbisRate      !== undefined) u.itbis_rate     = Number(d.itbisRate) || 0;
    if (d.itbisAmount    !== undefined) u.itbis_amount   = Number(d.itbisAmount) || 0;

    // Totals: merge investor sub-object into the jsonb
    if (d.totals !== undefined) {
      u.totals = { ...d.totals };
      if (d.investor) u.totals.investor = d.investor;
    } else if (d.investor) {
      // Need to read existing totals to merge investor into them
      const { data: cur } = await _sb.from('sales').select('totals').eq('id', String(id)).single();
      const existingTotals = (cur?.totals && typeof cur.totals === 'object') ? cur.totals : {};
      u.totals = { ...existingTotals, investor: d.investor };
    }

    const { data, error } = await _sb.from('sales').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _saleFromDb(data);
  },

  async remove(id) {
    const { error } = await _sb.from('sales').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },
};


// =============================================================================
// SALE LINES  (separate table — kept for compatibility)
//
// DB: id, sale_id, product_id, product_type, quantity, unit_price,
//     line_revenue, cost_per_unit_snapshot, line_cost, line_profit,
//     resale_cost_per_unit, created_at, updated_at
// =============================================================================

function _saleLineFromDb(r) {
  return {
    id:                  r.id,
    saleId:              r.sale_id,
    productId:           r.product_id,
    productType:         r.product_type,
    quantity:            Number(r.quantity),
    salePricePerUnit:    Number(r.unit_price),
    saleLineTotal:       Number(r.line_revenue),
    costPerUnitSnapshot: Number(r.cost_per_unit_snapshot),
    costLineTotal:       Number(r.line_cost),
    profitLine:          Number(r.line_profit),
    resaleCostPerUnit:   Number(r.resale_cost_per_unit),
    createdAt:           r.created_at,
    updatedAt:           r.updated_at,
  };
}

export const SaleLinesAPI = {
  async getAll() {
    const { data, error } = await _sb.from('sale_lines').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_saleLineFromDb);
  },

  async getById(id) {
    const { data, error } = await _sb.from('sale_lines').select('*')
      .eq('id', String(id)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _saleLineFromDb(data) : null;
  },

  async getBySaleId(saleId) {
    const { data, error } = await _sb.from('sale_lines').select('*')
      .eq('sale_id', String(saleId));
    if (error) throw new Error(error.message);
    return (data || []).map(_saleLineFromDb);
  },

  async create(d) {
    const qty   = Number(d.quantity) || 0;
    const price = Number(d.salePricePerUnit) || 0;
    const cost  = Number(d.costPerUnitSnapshot) || 0;
    const now   = new Date().toISOString();
    const row = {
      id:                    _genId('sl'),
      sale_id:               String(d.saleId),
      product_id:            String(d.productId),
      product_type:          d.productType || 'manufactured',
      quantity:              qty,
      unit_price:            price,
      line_revenue:          qty * price,
      cost_per_unit_snapshot: cost,
      line_cost:             qty * cost,
      line_profit:           qty * price - qty * cost,
      resale_cost_per_unit:  Number(d.resaleCostPerUnit) || 0,
      created_at:            now,
      updated_at:            now,
    };
    const { data, error } = await _sb.from('sale_lines').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _saleLineFromDb(data);
  },

  async update(id, d) {
    const { data: prev, error: e1 } = await _sb.from('sale_lines').select('*')
      .eq('id', String(id)).single();
    if (e1) throw new Error(e1.message);

    const qty   = d.quantity            !== undefined ? Number(d.quantity)            : Number(prev.quantity);
    const price = d.salePricePerUnit    !== undefined ? Number(d.salePricePerUnit)    : Number(prev.unit_price);
    const cost  = d.costPerUnitSnapshot !== undefined ? Number(d.costPerUnitSnapshot) : Number(prev.cost_per_unit_snapshot);
    const u = {
      product_id:             d.productId !== undefined ? String(d.productId) : prev.product_id,
      quantity:               qty,
      unit_price:             price,
      line_revenue:           qty * price,
      cost_per_unit_snapshot: cost,
      line_cost:              qty * cost,
      line_profit:            qty * price - qty * cost,
      updated_at:             new Date().toISOString(),
    };
    const { data, error } = await _sb.from('sale_lines').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _saleLineFromDb(data);
  },

  async remove(id) {
    const { error } = await _sb.from('sale_lines').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },

  async removeBySaleId(saleId) {
    const { data: rows } = await _sb.from('sale_lines').select('id')
      .eq('sale_id', String(saleId));
    const count = (rows || []).length;
    if (count) {
      const { error } = await _sb.from('sale_lines').delete()
        .eq('sale_id', String(saleId));
      if (error) throw new Error(error.message);
    }
    return { deleted: count };
  },
};


// =============================================================================
// CUSTOMERS
//
// DB: id, name, type, phone, email, address, tax_id, status (text),
//     created_at (bigint), updated_at (bigint)
// JS: id, name, type, phone, email, address, taxId,  status,
//     createdAt (number),  updatedAt (number)
// =============================================================================

function _customerFromDb(r) {
  return {
    id:        r.id,
    name:      r.name,
    type:      r.type,
    phone:     r.phone,
    email:     r.email,
    address:   r.address,
    taxId:     r.tax_id,
    status:    r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const CustomersAPI = {
  async getAll() {
    const { data, error } = await _sb.from('customers').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_customerFromDb);
  },

  async getById(id) {
    const { data, error } = await _sb.from('customers').select('*')
      .eq('id', String(id)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _customerFromDb(data) : null;
  },

  async create(d) {
    const now = Date.now();
    const row = {
      id:         _genId('cust'),
      name:       (d.name || '').trim(),
      type:       d.type || 'company',
      phone:      (d.phone || '').trim(),
      email:      (d.email || '').trim(),
      address:    (d.address || '').trim(),
      tax_id:     (d.taxId || '').trim(),
      status:     'active',
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await _sb.from('customers').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _customerFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: Date.now() };
    if (d.name    !== undefined) u.name    = (d.name || '').trim();
    if (d.type    !== undefined) u.type    = d.type || 'company';
    if (d.phone   !== undefined) u.phone   = (d.phone || '').trim();
    if (d.email   !== undefined) u.email   = (d.email || '').trim();
    if (d.address !== undefined) u.address = (d.address || '').trim();
    if (d.taxId   !== undefined) u.tax_id  = (d.taxId || '').trim();
    if (d.status  !== undefined) u.status  = d.status;

    const { data, error } = await _sb.from('customers').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _customerFromDb(data);
  },

  async softDelete(id)   { return this.update(id, { status: 'inactive' }); },
  async reactivate(id)   { return this.update(id, { status: 'active'   }); },
};


// =============================================================================
// INVESTOR
//
// DB: id, client_id, total_debt (numeric), history (jsonb),
//     created_at (bigint), updated_at (bigint)
// JS: id, clientId,  totalDebt,            history (array),
//     createdAt (number), updatedAt (number)
// =============================================================================

function _investorFromDb(r) {
  return {
    id:        r.id,
    clientId:  r.client_id,
    totalDebt: Number(r.total_debt),
    history:   Array.isArray(r.history) ? r.history : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function _investorRead() {
  const { data, error } = await _sb.from('investor').select('*').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? _investorFromDb(data) : null;
}

async function _investorWrite(record) {
  const { error } = await _sb.from('investor').update({
    total_debt: record.totalDebt,
    history:    record.history,
    client_id:  record.clientId,
    updated_at: Date.now(),
  }).eq('id', record.id);
  if (error) throw new Error(error.message);
}

export const InvestorAPI = {
  async get() { return _investorRead(); },

  async create(d) {
    const existing = await _investorRead();
    if (existing) return existing;
    const now = Date.now();
    const row = {
      id:         _genId('inv'),
      client_id:  String(d.clientId || ''),
      total_debt: 0,
      history:    [],
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await _sb.from('investor').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _investorFromDb(data);
  },

  async updateClient(clientId) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    record.clientId = String(clientId);
    await _investorWrite(record);
    return record;
  },

  async addInvestment(amount, note = '', referenceId = null, date = null) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error('El monto de inversión debe ser mayor que cero.');
    record.history.push({
      id: _genId('inv'), type: 'investment', amount: amt,
      date: date ?? Date.now(), referenceId: referenceId ?? null, note: (note || '').trim(),
    });
    record.totalDebt += amt;
    await _investorWrite(record);
    return record;
  },

  async addAmortization(amount, referenceId = null, note = '', date = null) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error('El monto de amortización debe ser mayor que cero.');
    if (amt > record.totalDebt) throw new Error(
      `El monto (${amt.toFixed(2)}) supera la deuda actual (${record.totalDebt.toFixed(2)}).`
    );
    record.history.push({
      id: _genId('inv'), type: 'amortization', amount: amt,
      date: date ?? Date.now(), referenceId: referenceId ?? null, note: (note || '').trim(),
    });
    record.totalDebt -= amt;
    await _investorWrite(record);
    return record;
  },

  async getHistory() {
    const record = await _investorRead();
    if (!record) return [];
    return [...record.history].reverse();
  },

  _netAmortizationForSale(record, referenceId) {
    if (!record) return 0;
    return (record.history || []).reduce((net, e) => {
      if (String(e.referenceId) !== String(referenceId)) return net;
      if (e.type === 'amortization') return net + e.amount;
      if (e.type === 'reversal')     return net - e.amount;
      return net;
    }, 0);
  },

  async setSaleAmortization(referenceId, targetAmount, note = '') {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const already = this._netAmortizationForSale(record, referenceId);
    const target  = Math.max(0, Number(targetAmount) || 0);
    const delta   = target - already;
    if (Math.abs(delta) < 0.001) return record;
    if (delta > 0) {
      return this.addAmortization(delta, referenceId, note || `Auto amort: ${referenceId}`);
    }
    const reversal = Math.abs(delta);
    record.history.push({
      id: _genId('inv'), type: 'reversal', amount: reversal,
      date: Date.now(), referenceId: String(referenceId),
      note: (note || `Reverso de amort.: ${referenceId}`).trim(),
    });
    record.totalDebt += reversal;
    await _investorWrite(record);
    return record;
  },

  async clearSaleAmortization(referenceId, note = '') {
    return this.setSaleAmortization(
      referenceId, 0, note || `Reversión por eliminación: ${referenceId}`
    );
  },

  // ── Expense / Raw-material financing ────────────────────────────────────────

  /** Net investment recorded for a given referenceId (expenses / raw materials). */
  _netInvestmentForRef(record, referenceId) {
    if (!record) return 0;
    return (record.history || []).reduce((net, e) => {
      if (String(e.referenceId) !== String(referenceId)) return net;
      if (e.type === 'investment')         return net + e.amount;
      if (e.type === 'investment_reversal') return net - e.amount;
      return net;
    }, 0);
  },

  /**
   * Set the net investment amount linked to a referenceId (expense / raw-material ID).
   * Adds an 'investment' entry if more is needed, or an 'investment_reversal' if less.
   * Pass targetAmount=0 to fully revert a previous investment.
   */
  async reconcileInvestmentByRef(referenceId, targetAmount, note = '') {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const already = this._netInvestmentForRef(record, referenceId);
    const target  = Math.max(0, Number(targetAmount) || 0);
    const delta   = target - already;
    if (Math.abs(delta) < 0.001) return record;
    if (delta > 0) {
      return this.addInvestment(delta, note || `Inversión: ${referenceId}`, referenceId);
    }
    // Partial or full reversal of a previous investment
    const reversal = Math.abs(delta);
    record.history.push({
      id: _genId('inv'), type: 'investment_reversal', amount: reversal,
      date: Date.now(), referenceId: String(referenceId),
      note: (note || `Reversión de inversión: ${referenceId}`).trim(),
    });
    record.totalDebt -= reversal;
    await _investorWrite(record);
    return record;
  },
};


// =============================================================================
// INVENTORY  (items + movements)
//
// items DB:      id, name, type, unit, stock (numeric), created_at (bigint), updated_at (bigint)
// movements DB:  id, item_id, type, quantity (numeric), date (bigint),
//                reference_id, note, created_at
// =============================================================================

function _invItemFromDb(r) {
  return {
    id:        r.id,
    name:      r.name,
    type:      r.type,
    unit:      r.unit,
    stock:     Number(r.stock),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function _invMovFromDb(r) {
  return {
    id:          r.id,
    itemId:      r.item_id,
    type:        r.type,
    quantity:    Number(r.quantity),
    date:        r.date,
    referenceId: r.reference_id,
    note:        r.note,
  };
}

async function _writeMovement(itemId, type, quantity, referenceId, note) {
  const row = {
    id:           _genId('mov'),
    item_id:      String(itemId),
    type,
    quantity,
    date:         Date.now(),
    reference_id: referenceId ?? null,
    note:         (note || '').trim(),
    created_at:   new Date().toISOString(),
  };
  const { error } = await _sb.from('inventory_movements').insert(row);
  if (error) throw new Error(error.message);
  return row;
}

export const InventoryAPI = {
  async getAll() {
    const { data, error } = await _sb.from('inventory_items').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_invItemFromDb);
  },

  async getById(id) {
    const { data, error } = await _sb.from('inventory_items').select('*')
      .eq('id', String(id)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _invItemFromDb(data) : null;
  },

  async createItem(d) {
    const now = Date.now();
    const row = {
      id:         _genId('item'),
      name:       (d.name || '').trim(),
      type:       d.type || 'finished_product',
      unit:       (d.unit || '').trim(),
      stock:      0,
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await _sb.from('inventory_items').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _invItemFromDb(data);
  },

  async updateItem(id, d) {
    const u = { updated_at: Date.now() };
    if (d.name !== undefined) u.name = (d.name || '').trim();
    if (d.type !== undefined) u.type = d.type;
    if (d.unit !== undefined) u.unit = (d.unit || '').trim();
    const { data, error } = await _sb.from('inventory_items').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _invItemFromDb(data);
  },

  async addStock(itemId, quantity, referenceId = null, note = '') {
    const { data: item, error: e1 } = await _sb.from('inventory_items').select('*')
      .eq('id', String(itemId)).single();
    if (e1) throw new Error(e1.message);
    const qty = Number(quantity);
    if (!qty || qty <= 0) throw new Error('La cantidad debe ser mayor que cero.');
    const newStock = Number(item.stock) + qty;
    const { data, error } = await _sb.from('inventory_items')
      .update({ stock: newStock, updated_at: Date.now() })
      .eq('id', String(itemId)).select().single();
    if (error) throw new Error(error.message);
    await _writeMovement(itemId, 'in', qty, referenceId, note);
    return _invItemFromDb(data);
  },

  async removeStock(itemId, quantity, referenceId = null, note = '') {
    const { data: item, error: e1 } = await _sb.from('inventory_items').select('*')
      .eq('id', String(itemId)).single();
    if (e1) throw new Error(e1.message);
    const qty = Number(quantity);
    if (!qty || qty <= 0) throw new Error('La cantidad debe ser mayor que cero.');
    if (qty > Number(item.stock)) throw new Error(
      `Stock insuficiente. Disponible: ${item.stock}, requerido: ${qty}.`
    );
    const newStock = Number(item.stock) - qty;
    const { data, error } = await _sb.from('inventory_items')
      .update({ stock: newStock, updated_at: Date.now() })
      .eq('id', String(itemId)).select().single();
    if (error) throw new Error(error.message);
    await _writeMovement(itemId, 'out', -qty, referenceId, note);
    return _invItemFromDb(data);
  },

  async adjustStock(itemId, quantity, note = '') {
    const { data: item, error: e1 } = await _sb.from('inventory_items').select('*')
      .eq('id', String(itemId)).single();
    if (e1) throw new Error(e1.message);
    const qty = Number(quantity);
    if (qty === 0 || isNaN(qty)) throw new Error('La cantidad de ajuste no puede ser cero.');
    const newStock = Number(item.stock) + qty;
    if (newStock < 0) throw new Error(
      `Ajuste inválido. Stock actual: ${item.stock}, ajuste: ${qty}, resultado: ${newStock}.`
    );
    const { data, error } = await _sb.from('inventory_items')
      .update({ stock: newStock, updated_at: Date.now() })
      .eq('id', String(itemId)).select().single();
    if (error) throw new Error(error.message);
    await _writeMovement(itemId, 'adjustment', qty, null, note);
    return _invItemFromDb(data);
  },

  async getMovements(itemId) {
    let query = _sb.from('inventory_movements').select('*');
    if (itemId !== undefined && itemId !== null) {
      query = query.eq('item_id', String(itemId));
    }
    const { data, error } = await query.order('date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(_invMovFromDb);
  },
};


// =============================================================================
// PRODUCT → INVENTORY LINK HELPERS
// =============================================================================

export async function ensureProductInventoryItem(product) {
  if (product.inventoryItemId) {
    const existing = await InventoryAPI.getById(product.inventoryItemId);
    if (existing) return product.inventoryItemId;
  }
  const newItem = await InventoryAPI.createItem({
    name: product.name, type: 'finished_product', unit: 'paquetes',
  });
  await ProductsAPI.update(product.id, { inventoryItemId: newItem.id });
  return newItem.id;
}

export async function ensureRawMaterialInventoryItem(materialType) {
  const { data: mapping } = await _sb.from('rm_inventory_map').select('item_id')
    .eq('key', materialType).maybeSingle();
  if (mapping) {
    const existing = await InventoryAPI.getById(mapping.item_id);
    if (existing) return mapping.item_id;
  }
  const names = { recycled: 'Tapas usadas', pellet: 'Peletizado virgen' };
  const newItem = await InventoryAPI.createItem({
    name: names[materialType] ?? `Materia prima (${materialType})`,
    type: 'raw_material', unit: 'lbs',
  });
  const { error } = await _sb.from('rm_inventory_map').upsert({
    key: materialType, item_id: newItem.id,
  });
  if (error) throw new Error(error.message);
  return newItem.id;
}


// =============================================================================
// EMPLOYEES
//
// DB: id, name, document, phone, email, position, monthly_salary (numeric),
//     is_active (bool), extra (jsonb), created_at, updated_at
// JS: id, name, document, phone, email, position, monthlySalary,
//     isActive, createdAt, updatedAt
// =============================================================================

function _employeeFromDb(r) {
  const extra = (r.extra && typeof r.extra === 'object') ? r.extra : {};
  return {
    id:            r.id,
    name:          r.name,
    document:      r.document,
    phone:         r.phone,
    email:         r.email,
    position:      r.position,
    monthlySalary: Number(r.monthly_salary),
    isActive:      r.is_active !== false,
    ...extra,
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
  };
}

const _empSkipKeys = new Set([
  'id', 'name', 'document', 'phone', 'email', 'position',
  'monthlySalary', 'isActive', 'createdAt', 'updatedAt', 'extra',
]);

function _employeeToDb(d) {
  const row = {};
  if (d.name          !== undefined) row.name           = (d.name || '').trim();
  if (d.document      !== undefined) row.document       = (d.document || '').trim();
  if (d.phone         !== undefined) row.phone          = (d.phone || '').trim();
  if (d.email         !== undefined) row.email          = (d.email || '').trim();
  if (d.position      !== undefined) row.position       = (d.position || '').trim();
  if (d.monthlySalary !== undefined) row.monthly_salary = Number(d.monthlySalary) || 0;
  if (d.isActive      !== undefined) row.is_active      = Boolean(d.isActive);
  const extra = {};
  for (const [k, v] of Object.entries(d)) {
    if (!_empSkipKeys.has(k)) extra[k] = v;
  }
  row.extra = extra;
  return row;
}

export const EmployeesAPI = {
  async getAll() {
    const { data, error } = await _sb.from('employees').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_employeeFromDb);
  },

  async create(d) {
    const row = {
      ..._employeeToDb(d),
      id:             _genId('emp'),
      is_active:      true,
      monthly_salary: Number(d.monthlySalary) || 0,
      created_at:     new Date().toISOString(),
    };
    const { data, error } = await _sb.from('employees').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _employeeFromDb(data);
  },

  async update(id, d) {
    const { data: raw } = await _sb.from('employees').select('extra')
      .eq('id', String(id)).single();
    const oldExtra = (raw?.extra && typeof raw.extra === 'object') ? raw.extra : {};
    const mapped = _employeeToDb(d);
    mapped.extra = { ...oldExtra, ...(mapped.extra || {}) };
    mapped.updated_at = new Date().toISOString();
    const { data, error } = await _sb.from('employees').update(mapped)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _employeeFromDb(data);
  },

  async deactivate(id) { return this.update(id, { isActive: false }); },
  async activate(id)   { return this.update(id, { isActive: true  }); },
};


// =============================================================================
// LOANS
//
// DB: id, person_key, principal, remaining, installment, start_month,
//     is_active, history (jsonb), created_at, updated_at
// JS: id, personKey,  principal, remaining, installment, startMonth,
//     isActive,  history (array), createdAt, updatedAt
// =============================================================================

function _loanFromDb(r) {
  return {
    id:          r.id,
    personKey:   r.person_key,
    principal:   Number(r.principal),
    remaining:   Number(r.remaining),
    installment: Number(r.installment),
    startMonth:  r.start_month,
    isActive:    r.is_active !== false,
    history:     Array.isArray(r.history) ? r.history : [],
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
  };
}

export const LoansAPI = {
  async getAll() {
    const { data, error } = await _sb.from('loans').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_loanFromDb);
  },

  async getByPersonKey(personKey) {
    const { data, error } = await _sb.from('loans').select('*')
      .eq('person_key', String(personKey));
    if (error) throw new Error(error.message);
    return (data || []).map(_loanFromDb);
  },

  async create(d) {
    const principal = Number(d.principal) || 0;
    const row = {
      id:          _genId('loan'),
      person_key:  String(d.personKey || ''),
      principal,
      remaining:   principal,
      installment: Number(d.installment) || 0,
      start_month: _normalizeMonth(d.startMonth),
      is_active:   true,
      history:     [],
      created_at:  new Date().toISOString(),
    };
    const { data, error } = await _sb.from('loans').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _loanFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: new Date().toISOString() };
    if (d.principal   !== undefined) u.principal   = Number(d.principal);
    if (d.installment !== undefined) u.installment = Number(d.installment);
    if (d.startMonth  !== undefined) u.start_month = _normalizeMonth(d.startMonth);
    if (d.isActive    !== undefined) u.is_active   = Boolean(d.isActive);
    if (d.personKey   !== undefined) u.person_key  = String(d.personKey);
    if (d.note        !== undefined) u.note        = d.note;
    const { data, error } = await _sb.from('loans').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _loanFromDb(data);
  },

  async deactivate(id) { return this.update(id, { isActive: false }); },
  async activate(id)   { return this.update(id, { isActive: true  }); },

  async addPayment(loanId, { month, amount, referenceId, note = '' }) {
    const { data: raw, error: e1 } = await _sb.from('loans').select('*')
      .eq('id', String(loanId)).single();
    if (e1) throw new Error(e1.message);
    const loan = _loanFromDb(raw);
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error('El monto del pago debe ser mayor que cero.');
    if (amt > loan.remaining) throw new Error(
      `El pago (${amt.toFixed(2)}) supera el saldo restante (${loan.remaining.toFixed(2)}).`
    );
    const entry = {
      id: _genId('lpay'), dateISO: new Date().toISOString(),
      month: _normalizeMonth(month), amount: amt,
      referenceId: String(referenceId || ''), note: (note || '').trim(),
    };
    const newRemaining = Math.max(0, loan.remaining - amt);
    const upd = {
      remaining: newRemaining, history: [...loan.history, entry],
      updated_at: new Date().toISOString(),
    };
    if (newRemaining === 0) upd.is_active = false;
    const { data, error } = await _sb.from('loans').update(upd)
      .eq('id', String(loanId)).select().single();
    if (error) throw new Error(error.message);
    return _loanFromDb(data);
  },

  async revertPaymentsByReference(referenceId) {
    const refStr = String(referenceId || '');
    const { data: allLoans, error } = await _sb.from('loans').select('*');
    if (error) throw new Error(error.message);
    for (const raw of (allLoans || [])) {
      const hist     = Array.isArray(raw.history) ? raw.history : [];
      const matching = hist.filter(e => e.referenceId === refStr);
      if (!matching.length) continue;
      const totalReverted = matching.reduce((s, e) => s + e.amount, 0);
      const newHistory    = hist.filter(e => e.referenceId !== refStr);
      const newRemaining  = Number(raw.remaining) + totalReverted;
      await _sb.from('loans').update({
        remaining: newRemaining, history: newHistory,
        is_active: newRemaining > 0 ? true : raw.is_active,
        updated_at: new Date().toISOString(),
      }).eq('id', raw.id);
    }
    return null;
  },
};


// =============================================================================
// PAYROLL
//
// DB: id, month, period (int), period_key, snapshot (jsonb),
//     created_at, updated_at
// JS: id, month, period, periodKey, + all snapshot fields spread
//     (isClosed, closedAt, loanReferenceId, totals, rows, etc.)
// =============================================================================

function _payrollFromDb(r) {
  const snap = (r.snapshot && typeof r.snapshot === 'object') ? r.snapshot : {};
  return {
    id:        r.id,
    month:     r.month,
    period:    r.period,
    periodKey: r.period_key,
    ...snap,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const PayrollAPI = {
  async getAll() {
    const { data, error } = await _sb.from('payroll_runs').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_payrollFromDb);
  },

  async getByPeriod(month, period) {
    const pk = _normalizePeriodKey(month, period);
    const { data, error } = await _sb.from('payroll_runs').select('*')
      .eq('period_key', pk).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _payrollFromDb(data) : null;
  },

  async upsertByPeriod(month, period, snapshot) {
    const nm = _normalizeMonth(month);
    const pk = _normalizePeriodKey(month, period);
    const { id: _i, month: _m, period: _p, periodKey: _pk,
            createdAt: _ca, updatedAt: _ua, ...snapData } = snapshot;

    const existing = await this.getByPeriod(month, period);

    if (!existing) {
      const row = {
        id:         _genId('pay'),
        month:      nm,
        period:     period === 1 ? 1 : 2,
        period_key: pk,
        snapshot:   snapData,
        created_at: new Date().toISOString(),
      };
      const { data, error } = await _sb.from('payroll_runs').insert(row).select().single();
      if (error) throw new Error(error.message);
      return _payrollFromDb(data);
    }

    const { data, error } = await _sb.from('payroll_runs').update({
      snapshot: snapData, updated_at: new Date().toISOString(),
    }).eq('period_key', pk).select().single();
    if (error) throw new Error(error.message);
    return _payrollFromDb(data);
  },

  async removeByPeriod(month, period) {
    const pk = _normalizePeriodKey(month, period);
    const { error } = await _sb.from('payroll_runs').delete().eq('period_key', pk);
    if (error) throw new Error(error.message);
    return null;
  },

  async getByMonth(month)          { return this.getByPeriod(month, 2); },
  async upsertByMonth(month, snap) { return this.upsertByPeriod(month, 2, snap); },
  async removeByMonth(month)       { return this.removeByPeriod(month, 2); },
};


// =============================================================================
// EXPENSES
//
// DB: id, expense_date, category, description, amount, method, notes,
//     attachments (jsonb), created_at, updated_at
// JS: id, expenseDate,  category, description, amount, method, notes,
//     attachments, createdAt, updatedAt
// =============================================================================

function _expenseFromDb(r) {
  return {
    id:                r.id,
    expenseDate:       r.expense_date,
    category:          r.category,
    description:       r.description,
    amount:            Number(r.amount),
    method:            r.method,
    notes:             r.notes,
    attachments:       Array.isArray(r.attachments) ? r.attachments : [],
    investorFinancing: r.investor_financing || null,
    createdAt:         r.created_at,
    updatedAt:         r.updated_at,
  };
}

export const ExpensesAPI = {
  async getAll() {
    const { data, error } = await _sb.from('expenses').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_expenseFromDb);
  },

  async getById(id) {
    const { data, error } = await _sb.from('expenses').select('*')
      .eq('id', String(id)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _expenseFromDb(data) : null;
  },

  async create(d) {
    const now = new Date().toISOString();
    const row = {
      id:                 _genId('exp'),
      expense_date:       d.expenseDate || d.expense_date || '',
      category:           d.category || '',
      description:        d.description || '',
      amount:             Number(d.amount) || 0,
      method:             d.method || '',
      notes:              d.notes || '',
      attachments:        Array.isArray(d.attachments) ? d.attachments : [],
      investor_financing: d.investorFinancing || null,
      created_at:         now,
      updated_at:         now,
    };
    const { data, error } = await _sb.from('expenses').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _expenseFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: new Date().toISOString() };
    if (d.expenseDate        !== undefined) u.expense_date       = d.expenseDate;
    if (d.category           !== undefined) u.category           = d.category;
    if (d.description        !== undefined) u.description        = d.description;
    if (d.amount             !== undefined) u.amount             = Number(d.amount) || 0;
    if (d.method             !== undefined) u.method             = d.method;
    if (d.notes              !== undefined) u.notes              = d.notes;
    if (d.attachments        !== undefined) u.attachments        = d.attachments;
    if (d.investorFinancing  !== undefined) u.investor_financing = d.investorFinancing;
    const { data, error } = await _sb.from('expenses').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _expenseFromDb(data);
  },

  async remove(id) {
    const { error } = await _sb.from('expenses').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },
};


// =============================================================================
// SALE PAYMENTS
//
// DB: id (uuid), sale_id, payment_date, amount, method, notes, created_at
// JS: id,        saleId,  paymentDate,  amount, method, notes, createdAt
// =============================================================================

function _salePaymentFromDb(r) {
  return {
    id:          r.id,
    saleId:      r.sale_id,
    paymentDate: r.payment_date,
    amount:      Number(r.amount),
    method:      r.method,
    notes:       r.notes,
    createdAt:   r.created_at,
  };
}

export const SalePaymentsAPI = {
  async getAll() {
    const { data, error } = await _sb.from('sale_payments').select('*');
    if (error) throw new Error(error.message);
    return (data || []).map(_salePaymentFromDb);
  },

  async getBySaleId(saleId) {
    const { data, error } = await _sb.from('sale_payments').select('*')
      .eq('sale_id', String(saleId));
    if (error) throw new Error(error.message);
    return (data || []).map(_salePaymentFromDb);
  },

  async create(d) {
    const row = {
      sale_id:      String(d.saleId || ''),
      payment_date: d.paymentDate || d.payment_date || '',
      amount:       Number(d.amount) || 0,
      method:       d.method || '',
      notes:        d.notes || '',
      created_at:   new Date().toISOString(),
    };
    const { data, error } = await _sb.from('sale_payments').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _salePaymentFromDb(data);
  },

  async remove(id) {
    const { error } = await _sb.from('sale_payments').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },

  async removeBySaleId(saleId) {
    const { error } = await _sb.from('sale_payments').delete()
      .eq('sale_id', String(saleId));
    if (error) throw new Error(error.message);
    return null;
  },
};


// =============================================================================
// CHANGE HISTORY  (audit log)
//
// DB: id (uuid), entity_type, entity_id, entity_name, action, changes (jsonb),
//     created_at
// =============================================================================

export const ChangeHistoryAPI = {
  /**
   * Log a change event.  Failures are caught silently so they never block the
   * main user action.
   *
   * @param {Object} entry
   * @param {string} entry.entity_type  - 'product' | 'machine' | etc.
   * @param {string} entry.entity_id    - Record ID
   * @param {string} entry.entity_name  - Human-readable name
   * @param {string} entry.action       - 'crear' | 'editar' | 'activar' | 'desactivar' | 'eliminar'
   * @param {Object} [entry.changes]    - { field: { before, after } }
   */
  async log(entry) {
    try {
      const { error } = await _sb.from('change_history').insert({
        entity_type: entry.entity_type,
        entity_id:   String(entry.entity_id ?? ''),
        entity_name: entry.entity_name ?? '',
        action:      entry.action,
        changes:     entry.changes ?? null,
        user_id:     entry.user_id   ?? null,
        user_name:   entry.user_name ?? null,
      });
      if (error) console.warn('[CapFlow] Change log error:', error.message);
    } catch (err) {
      console.warn('[CapFlow] Change log failed:', err.message);
    }
  },

  /**
   * Fetch recent change history entries.
   *
   * @param {Object}  [opts]
   * @param {string}  [opts.entity_type] - Filter by entity type
   * @param {number}  [opts.limit=200]   - Max records
   * @returns {Promise<Array>}
   */
  async getAll({ entity_type, limit = 200 } = {}) {
    let query = _sb
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

// =============================================================================
// INVOICE NUMBERING
//
// Calls the Supabase RPC `next_invoice_number(p_prefix)` which atomically
// increments a counter and returns the next formatted number (e.g. "FAC-007").
// Falls back to a direct MAX query if the RPC is unavailable.
// =============================================================================

export async function nextInvoiceNumber(prefix = 'FAC-') {
  const { data, error } = await _sb.rpc('next_invoice_number', { p_prefix: prefix });
  if (!error && data) return data;

  // Fallback: derive next number from existing invoices (non-atomic but safe for
  // low-concurrency environments while the migration has not been applied yet).
  const { data: rows } = await _sb
    .from('sales')
    .select('invoice_number')
    .like('invoice_number', `${prefix}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!rows || rows.length === 0) return `${prefix}001`;
  const last = rows[0].invoice_number;
  const num  = parseInt(last.replace(prefix, ''), 10) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
}

// ─── Daily Production Logs ────────────────────────────────────────────────────

export const DailyProductionLogsAPI = {
  async getAll({ status, operatorId, dateFrom, dateTo } = {}) {
    let query = _sb
      .from('daily_production_logs')
      .select('*')
      .order('production_date', { ascending: false })
      .order('created_at',      { ascending: false });

    if (status)     query = query.eq('status', status);
    if (operatorId) query = query.eq('operator_id', operatorId);
    if (dateFrom)   query = query.gte('production_date', dateFrom);
    if (dateTo)     query = query.lte('production_date', dateTo);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async update(id, fields = {}) {
    const u = { updated_at: new Date().toISOString() };
    if (fields.production_date !== undefined) u.production_date = fields.production_date;
    if (fields.product_id      !== undefined) u.product_id      = fields.product_id || null;
    if (fields.shift           !== undefined) u.shift           = fields.shift || null;
    if (fields.machine_id      !== undefined) u.machine_id      = fields.machine_id || null;
    if (fields.quantity        !== undefined) u.quantity        = fields.quantity;
    if (fields.notes           !== undefined) u.notes           = fields.notes;
    if (fields.color           !== undefined) u.color           = fields.color;
    if (fields.status          !== undefined) u.status          = fields.status;
    if (fields.confirmed_at    !== undefined) u.confirmed_at    = fields.confirmed_at;

    const { data, error } = await _sb
      .from('daily_production_logs')
      .update(u)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async confirm(id) {
    const { data, error } = await _sb
      .from('daily_production_logs')
      .update({
        status:       'confirmed',
        confirmed_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async remove(id) {
    const { error } = await _sb.from('daily_production_logs').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

// ─── Dispatch Operators ───────────────────────────────────────────────────────

export const DispatchOperatorsAPI = {
  async getAll() {
    const { data, error } = await _sb
      .from('dispatch_operators')
      .select('id, name, role, is_active, capflow_operator_id')
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};
