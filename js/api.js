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
    const row           = _productionToDb(d);
    const productionId  = _genId();
    const movementId    = _genId('mov');

    const { data, error } = await _sb.rpc('create_production_with_inventory_credit', {
      p_production_id:          productionId,
      p_product_id:             row.product_id,
      p_movement_id:            movementId,
      p_quantity:               row.quantity,
      p_production_date:        row.production_date,
      p_machine_id:             row.machine_id          ?? null,
      p_operator_id:            row.operator_id         ?? null,
      p_shift:                  row.shift               ?? null,
      p_month:                  row.month               || null,
      p_operator_rate_snapshot: row.operator_rate_snapshot ?? null,
      p_extra:                  row.extra               ?? {},
      p_movement_note:          'Salida de producción',
    });
    if (error) throw new Error(error.message);
    return _productionFromDb(Array.isArray(data) ? data[0] : data);
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

  async getByMonth(ym) {
    // ym is 'YYYY-MM'. shift_date is a DATE column; filter by [start, nextMonth).
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('Mes inválido');
    const [y, m] = ym.split('-').map(Number);
    const start  = `${ym}-01`;
    const nextY  = m === 12 ? y + 1 : y;
    const nextM  = m === 12 ? 1     : m + 1;
    const next   = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
    const { data, error } = await _sb
      .from('package_weights')
      .select('id, weight_lbs, operator_name, shift_date, notes, created_at')
      .gte('shift_date', start)
      .lt ('shift_date', next)
      .order('shift_date', { ascending: true })
      .order('created_at', { ascending: true });
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
    id:                  r.id,
    materialType:        r.type,
    type:                r.type,
    date:                r.purchase_date,
    purchaseDate:        r.purchase_date,
    month:               r.month,
    weightLbs:           Number(r.weight_lbs),
    totalCost:           Number(r.cost),
    washedWeightLbs:     Number(r.washed_weight_lbs),
    washingCost:         Number(r.washing_cost),
    supplierId:          r.provider_id,
    providerId:          r.provider_id,
    notes:               r.notes,
    isPayable:           r.is_payable === true,
    creditorType:        r.creditor_type  ?? null,
    creditorId:          r.creditor_id    ?? null,
    payableStatus:       r.payable_status ?? 'unpaid',
    dueDate:             r.due_date       ?? null,
    paidAmount:          Number(r.paid_amount ?? 0),
    investorHistoryId:   r.investor_history_id ?? null,
    ...extra,
    createdAt:           r.created_at,
    updatedAt:           r.updated_at,
  };
}

const _rmSkipKeys = new Set([
  'id', 'materialType', 'type', 'date', 'purchaseDate', 'month',
  'weightLbs', 'totalCost', 'cost', 'washedWeightLbs', 'washingCost',
  'supplierId', 'providerId', 'notes',
  'isPayable', 'creditorType', 'creditorId', 'payableStatus', 'dueDate',
  'paidAmount', 'investorHistoryId',
  // legacy extra key — no longer persisted; reads via spread above still work
  'investorFinancing',
  'createdAt', 'updatedAt', 'extra',
]);

function _rawMaterialToDb(d) {
  const purchaseDate = d.date || d.purchaseDate || '';
  const isPayable    = Boolean(d.isPayable);
  const row = {
    type:                d.materialType || d.type || '',
    purchase_date:       purchaseDate,
    month:               d.month || purchaseDate.slice(0, 7),
    weight_lbs:          Number(d.weightLbs) || 0,
    cost:                Number(d.totalCost ?? d.cost) || 0,
    washed_weight_lbs:   Number(d.washedWeightLbs) || 0,
    washing_cost:        Number(d.washingCost) || 0,
    provider_id:         d.supplierId || d.providerId || '',
    notes:               d.notes || '',
    is_payable:          isPayable,
    creditor_type:       isPayable ? (d.creditorType  || null) : null,
    creditor_id:         isPayable ? (d.creditorId    || null) : null,
    payable_status:      isPayable ? (d.payableStatus || 'unpaid') : 'unpaid',
    due_date:            isPayable ? (d.dueDate       || null) : null,
    paid_amount:         isPayable ? (Number(d.paidAmount) || 0) : 0,
    investor_history_id: isPayable ? null : (d.investorHistoryId || null),
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
    if (d.isPayable && d.investorHistoryId) {
      throw new Error('Una compra no puede ser cuenta por pagar e inversión al mismo tiempo.');
    }
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
    if (d.isPayable && d.investorHistoryId) {
      throw new Error('Una compra no puede ser cuenta por pagar e inversión al mismo tiempo.');
    }
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
    const sale = _saleFromDb(data);
    await _syncSaleInvestorState(sale, { giveMargin: d.giveMargin });
    return sale;
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
    const sale = _saleFromDb(data);
    await _syncSaleInvestorState(sale, { giveMargin: d.giveMargin });
    return sale;
  },

  async remove(id) {
    // Append a reversal entry to investor.history that restores totalDebt.
    // The investor_payouts row is removed by FK cascade (ON DELETE CASCADE).
    try {
      await InvestorAPI.clearSaleAmortization(
        String(id), `Reverso por eliminación de venta ${id}`
      );
    } catch (err) {
      console.warn('[CapFlow] clearSaleAmortization on remove:', err.message);
    }
    const { error } = await _sb.from('sales').delete().eq('id', String(id));
    if (error) throw new Error(error.message);
    return null;
  },

  /**
   * Confirm a pending sale and debit finished-goods inventory atomically.
   * Delegates to the Postgres RPC `confirm_sale_with_inventory_debit`, which
   * inside one transaction:
   *   1. Locks the sale row and verifies status='pending_review'.
   *   2. For every line with productType='manufactured', debits the linked
   *      inventory item via apply_inventory_movement (stock UPDATE +
   *      movement INSERT, atomic).
   *   3. Sets sale.status='confirmed' and updated_at=now().
   *
   * If any step fails (insufficient stock, missing product link, status no
   * longer pending), the entire transaction rolls back: stock unchanged, no
   * movement rows written, sale stays pending_review. The caller MUST have
   * called ensureProductInventoryItem(product) for each manufactured line
   * before invoking this method, otherwise the RPC raises.
   *
   * @param {string} saleId
   * @param {string} note    - movement note used for every debit row
   * @returns {Promise<Object>} the updated sale (mapped via _saleFromDb)
   */
  async confirmWithInventoryDebit(saleId, note = 'Venta despachada confirmada') {
    const { data, error } = await _sb.rpc('confirm_sale_with_inventory_debit', {
      p_sale_id: String(saleId),
      p_note:    note,
    });
    if (error) throw new Error(error.message);
    const sale = _saleFromDb(Array.isArray(data) ? data[0] : data);
    await _syncSaleInvestorState(sale);
    return sale;
  },

  // NOTE: confirmWithInventoryDebit above does not receive giveMargin from the
  // caller; the sync helper falls back to the existing payout's flag (or true
  // for a brand-new payout), which is the right default for the
  // pending→confirmed transition initiated from Ventas Pendientes.

  /**
   * Create a sale and debit finished-goods inventory atomically.
   * Wraps INSERT into sales + apply_inventory_movement for every manufactured
   * line in a single Postgres transaction. If any line is invalid (missing
   * productId, missing inventory link, insufficient stock) the entire
   * transaction rolls back: no sale row, no movement rows, stock unchanged.
   *
   * Caller MUST have run ensureProductInventoryItem(product) for every
   * manufactured line before invoking this method.
   *
   * @param {Object} d    - sale payload (camelCase, same shape as create())
   * @param {string} note - movement note used for every debit row
   * @returns {Promise<Object>} the created sale (mapped via _saleFromDb)
   */
  async createWithInventoryDebit(d, note = 'Venta') {
    const saleDate = d.saleDate || '';
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
      itbis_rate:     Number(d.itbisRate)   || 0,
      itbis_amount:   Number(d.itbisAmount) || 0,
    };
    const { data, error } = await _sb.rpc('create_sale_with_inventory_debit', {
      p_sale: row,
      p_note: note,
    });
    if (error) throw new Error(error.message);
    const sale = _saleFromDb(Array.isArray(data) ? data[0] : data);
    await _syncSaleInvestorState(sale, { giveMargin: d.giveMargin });
    return sale;
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
// INVESTOR PAYOUTS  (Entregas a Borbón)
//
// One row per confirmed manufactured-bearing sale to a NON-Borbón customer.
// Tracks the cash the factory still owes Borbón (RD$100/pkg benefit +
// resale margin above RD$735/pkg). The RD$100/pkg amortization is NOT
// reflected here — it lives in investor.history and reduces total_debt
// at sale creation/confirmation time.
//
// DB: id, sale_id, sale_date, packages_total, benefit_total, margin_total,
//     total_owed (generated), status, delivered_at, delivered_note,
//     created_at, updated_at
// JS: same names in camelCase
// =============================================================================

/** RD$ constants — single source of truth for the universal investor cut. */
export const INVESTOR_AMORTIZATION_PER_PKG = 100;
export const INVESTOR_BENEFIT_PER_PKG      = 100;
export const WHOLESALE_PRICE_PER_PKG       = 735;

function _payoutFromDb(r) {
  return {
    id:             r.id,
    saleId:         r.sale_id,
    saleDate:       r.sale_date,
    packagesTotal:  Number(r.packages_total) || 0,
    benefitTotal:   Number(r.benefit_total)  || 0,
    marginTotal:    Number(r.margin_total)   || 0,
    totalOwed:      Number(r.total_owed)     || 0,
    status:         r.status || 'pending',
    giveMarginToInvestor:
      r.give_margin_to_investor === undefined || r.give_margin_to_investor === null
        ? true
        : !!r.give_margin_to_investor,
    deliveredAt:    r.delivered_at,
    deliveredNote:  r.delivered_note,
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  };
}

function _payoutToDb(d) {
  const row = {};
  if (d.saleId         !== undefined) row.sale_id         = String(d.saleId);
  if (d.saleDate       !== undefined) row.sale_date       = d.saleDate;
  if (d.packagesTotal  !== undefined) row.packages_total  = Number(d.packagesTotal) || 0;
  if (d.benefitTotal   !== undefined) row.benefit_total   = Number(d.benefitTotal)  || 0;
  if (d.marginTotal    !== undefined) row.margin_total    = Number(d.marginTotal)   || 0;
  if (d.status         !== undefined) row.status          = d.status;
  if (d.deliveredAt    !== undefined) row.delivered_at    = d.deliveredAt;
  if (d.deliveredNote  !== undefined) row.delivered_note  = d.deliveredNote;
  if (d.giveMarginToInvestor !== undefined) {
    row.give_margin_to_investor = !!d.giveMarginToInvestor;
  }
  return row;
}

export const InvestorPayoutsAPI = {
  /**
   * List investor payouts. Excludes any payout whose underlying sale was
   * rejected (sales.status='rejected') — defensive in addition to the
   * application-side cleanup, in case of legacy rows.
   */
  async list({ status, dateFrom, dateTo } = {}) {
    let q = _sb.from('investor_payouts')
      .select('*, sales!inner(status)')
      .neq('sales.status', 'rejected')
      .order('sale_date', { ascending: false });
    if (status)   q = q.eq('status', status);
    if (dateFrom) q = q.gte('sale_date', dateFrom);
    if (dateTo)   q = q.lte('sale_date', dateTo);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(_payoutFromDb);
  },

  async getBySaleId(saleId) {
    const { data, error } = await _sb.from('investor_payouts').select('*')
      .eq('sale_id', String(saleId)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? _payoutFromDb(data) : null;
  },

  async markDelivered(id, { deliveredAt, deliveredNote } = {}) {
    const u = {
      status:         'delivered',
      delivered_at:   deliveredAt || new Date().toISOString(),
      delivered_note: deliveredNote || null,
      updated_at:     new Date().toISOString(),
    };
    const { data, error } = await _sb.from('investor_payouts').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _payoutFromDb(data);
  },

  async revertDelivery(id) {
    const u = {
      status:         'pending',
      delivered_at:   null,
      delivered_note: null,
      updated_at:     new Date().toISOString(),
    };
    const { data, error } = await _sb.from('investor_payouts').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _payoutFromDb(data);
  },

  /**
   * Internal: upsert a payout row for a sale (used by the universal sync helper).
   * `giveMarginToInvestor` is persisted; when false the caller should pass
   * `marginTotal: 0` (the helper validates regardless and zeros it out).
   */
  async _upsertForSale({
    saleId, saleDate, packagesTotal, benefitTotal, marginTotal,
    giveMarginToInvestor,
  }) {
    const giveMargin = giveMarginToInvestor === undefined ? true : !!giveMarginToInvestor;
    const safeMargin = giveMargin ? Number(marginTotal) || 0 : 0;

    const existing = await this.getBySaleId(saleId);
    if (existing) {
      const u = _payoutToDb({
        saleDate, packagesTotal, benefitTotal,
        marginTotal: safeMargin,
        giveMarginToInvestor: giveMargin,
      });
      u.updated_at = new Date().toISOString();
      const { data, error } = await _sb.from('investor_payouts').update(u)
        .eq('id', existing.id).select().single();
      if (error) throw new Error(error.message);
      return _payoutFromDb(data);
    }
    const row = _payoutToDb({
      saleId, saleDate, packagesTotal, benefitTotal,
      marginTotal: safeMargin,
      giveMarginToInvestor: giveMargin,
    });
    row.id     = _genId('pay');
    row.status = 'pending';
    const { data, error } = await _sb.from('investor_payouts').insert(row).select().single();
    if (error) throw new Error(error.message);
    return _payoutFromDb(data);
  },

  /** Internal: hard-delete the payout row for a sale (used when sale becomes Borbón/non-manufactured). */
  async _deleteBySaleId(saleId) {
    const { error } = await _sb.from('investor_payouts').delete()
      .eq('sale_id', String(saleId));
    if (error) throw new Error(error.message);
  },
};


/**
 * Universal investor-cut sync for a single sale (status='confirmed').
 *
 * Per package of every manufactured line:
 *   • RD$100 amortizes investor debt (always — even for non-Borbón sales)
 *   • For non-Borbón sales, an investor_payouts row tracks the RD$100
 *     pending benefit + (optionally) the resale margin
 *     (unitPrice − 735, clamped >=0)
 *
 * Rejected sales (status='rejected') or sales without manufactured lines
 * have neither amortization nor a payout row — any prior residue is
 * reversed here. Idempotent: safe to call repeatedly.
 *
 * @param {{ id:string, clientId:string, status:string, lines:Array,
 *           saleDate:string, invoiceNumber:string }} sale
 * @param {{ giveMargin?:boolean }} [opts]
 *        giveMargin: whether the resale margin counts toward Borbón's
 *        payout row. If omitted, the prior value on the existing payout
 *        row is preserved (default true if no row exists).
 */
async function _syncSaleInvestorState(sale, opts = {}) {
  if (!sale || !sale.id) return;

  const investor = await _investorRead();
  if (!investor) return;

  const isConfirmed = sale.status === 'confirmed';
  const mfgLines = (sale.lines || []).filter(
    l => l.productType === 'manufactured' && Number(l.quantity) > 0
  );
  const totalPkgs = mfgLines.reduce((s, l) => s + Number(l.quantity), 0);
  const invLabel  = sale.invoiceNumber || sale.id;

  if (!isConfirmed || totalPkgs <= 0) {
    // Detect prior state before clearing so we can log meaningful reversals.
    const priorAmort  = InvestorAPI._netAmortizationForSale(investor, sale.id);
    const priorPayout = await InvestorPayoutsAPI.getBySaleId(sale.id);

    await InvestorAPI.setSaleAmortization(sale.id, 0,
      `Sin paquetes manufacturados — ${invLabel}`);
    await InvestorPayoutsAPI._deleteBySaleId(sale.id);

    if (priorAmort > 0.001) {
      await ChangeHistoryAPI.log({
        entity_type: 'investor',
        entity_id:   sale.id,
        entity_name: `Venta ${invLabel}`,
        action:      'revertir',
        changes: {
          amortizacion: { before: priorAmort, after: 0 },
          motivo:       { before: null,
                          after: sale.status === 'rejected'
                            ? 'Venta rechazada — amortización revertida'
                            : 'Sin paquetes manufacturados — amortización revertida' },
        },
        user_name: 'Sistema (sync investor)',
        source:    'capflow',
      });
    }
    if (priorPayout) {
      await ChangeHistoryAPI.log({
        entity_type: 'investor_payout',
        entity_id:   priorPayout.id,
        entity_name: `Venta ${invLabel}`,
        action:      'eliminar',
        changes: {
          paquetes:  { before: priorPayout.packagesTotal, after: null },
          beneficio: { before: priorPayout.benefitTotal,  after: null },
          margen:    { before: priorPayout.marginTotal,   after: null },
          total:     { before: priorPayout.totalOwed,     after: null },
          motivo:    { before: null,
                       after: sale.status === 'rejected'
                         ? 'Venta rechazada — entrega pendiente eliminada'
                         : 'Sin paquetes manufacturados — entrega pendiente eliminada' },
        },
        user_name: 'Sistema (sync investor)',
        source:    'capflow',
      });
    }
    return;
  }

  const totalAmort = totalPkgs * INVESTOR_AMORTIZATION_PER_PKG;
  const saleDateMs = sale.saleDate
    ? new Date(`${sale.saleDate}T12:00:00Z`).getTime()
    : Date.now();
  await InvestorAPI.setSaleAmortization(
    sale.id, totalAmort,
    `Venta ${invLabel}`,
    saleDateMs
  );

  const isBorbon = String(sale.clientId) === String(investor.clientId);
  if (isBorbon) {
    await InvestorPayoutsAPI._deleteBySaleId(sale.id);
    return;
  }

  // Determine the giveMargin flag. Explicit caller value wins; otherwise
  // preserve the prior payout's flag (default true if there's no prior).
  let giveMargin;
  if (opts.giveMargin !== undefined) {
    giveMargin = !!opts.giveMargin;
  } else {
    const prior = await InvestorPayoutsAPI.getBySaleId(sale.id);
    giveMargin = prior ? prior.giveMarginToInvestor !== false : true;
  }

  const benefitTotal = totalPkgs * INVESTOR_BENEFIT_PER_PKG;
  const marginTotal  = giveMargin
    ? mfgLines.reduce(
        (s, l) => s + Math.max(0, Number(l.unitPrice) - WHOLESALE_PRICE_PER_PKG)
                      * Number(l.quantity),
        0
      )
    : 0;
  await InvestorPayoutsAPI._upsertForSale({
    saleId:               sale.id,
    saleDate:             sale.saleDate,
    packagesTotal:        totalPkgs,
    benefitTotal,
    marginTotal,
    giveMarginToInvestor: giveMargin,
  });
}


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

  /**
   * Ensure there is exactly one amortization history entry for the given
   * sale with the requested amount. Updates the existing entry in place
   * when possible (preserving its id), inserts a new one if absent, or
   * removes it when targetAmount === 0. Adjusts totalDebt for the delta.
   *
   * Used on sale create / edit while the sale is confirmed.
   */
  async setSaleAmortization(referenceId, targetAmount, note = '', date = null) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const target = Math.max(0, Number(targetAmount) || 0);
    const idx = (record.history || []).findIndex(
      e => e.type === 'amortization' && String(e.referenceId) === String(referenceId)
    );
    const existing = idx >= 0 ? record.history[idx] : null;

    if (existing) {
      if (target === 0) {
        record.totalDebt += existing.amount;
        record.history.splice(idx, 1);
      } else if (Math.abs(target - existing.amount) >= 0.001 || note || date != null) {
        record.totalDebt -= (target - existing.amount);
        existing.amount = target;
        if (note) existing.note = String(note).trim();
        if (date != null) existing.date = date;
      } else {
        return record;
      }
    } else if (target > 0) {
      record.history.push({
        id: _genId('inv'), type: 'amortization', amount: target,
        date: date ?? Date.now(), referenceId: String(referenceId),
        note: (note || `Amortización: ${referenceId}`).trim(),
      });
      record.totalDebt -= target;
    } else {
      return record;
    }

    await _investorWrite(record);
    return record;
  },

  /**
   * Reverse the amortization linked to a sale by appending a `reversal`
   * history entry whose amount equals the net amortization still pending
   * for that sale. The amortization entry itself is NOT removed — the
   * reversal preserves the audit trail. Used on sale deletion.
   */
  async clearSaleAmortization(referenceId, note = '') {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const net = this._netAmortizationForSale(record, referenceId);
    if (net <= 0.001) return record;
    record.history.push({
      id: _genId('inv'), type: 'reversal', amount: net,
      date: Date.now(), referenceId: String(referenceId),
      note: (note || `Reverso por eliminación: ${referenceId}`).trim(),
    });
    record.totalDebt += net;
    await _investorWrite(record);
    return record;
  },

  /** Update an amortization-type history entry in place; adjusts totalDebt for the delta. */
  async updateAmortizationEntry(entryId, { amount, note, date } = {}) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const entry = record.history.find(e => e.id === entryId);
    if (!entry) throw new Error(`Entrada de historial no encontrada: ${entryId}`);
    if (entry.type !== 'amortization') {
      throw new Error('Solo entradas de tipo amortización se pueden editar así.');
    }
    if (amount !== undefined) {
      const newAmt = Math.max(0, Number(amount) || 0);
      record.totalDebt -= (newAmt - entry.amount);
      entry.amount = newAmt;
    }
    if (note !== undefined) entry.note = String(note || '').trim();
    if (date !== undefined) entry.date = date;
    await _investorWrite(record);
    return record;
  },

  /** Remove an amortization-type history entry; restores totalDebt by its amount. */
  async deleteAmortizationEntry(entryId) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const idx = record.history.findIndex(e => e.id === entryId);
    if (idx === -1) throw new Error(`Entrada de historial no encontrada: ${entryId}`);
    const entry = record.history[idx];
    if (entry.type !== 'amortization') {
      throw new Error('Solo entradas de tipo amortización se pueden eliminar así.');
    }
    record.totalDebt += entry.amount;
    record.history.splice(idx, 1);
    await _investorWrite(record);
    return record;
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

  /** Update an investment-type history entry in place; adjusts totalDebt for the delta. */
  async updateInvestmentEntry(entryId, { amount, note, date } = {}) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const entry = record.history.find(e => e.id === entryId);
    if (!entry) throw new Error(`Entrada de historial no encontrada: ${entryId}`);
    if (entry.type !== 'investment') throw new Error('Solo entradas de tipo inversión se pueden editar.');
    if (amount !== undefined) {
      const newAmt = Number(amount);
      if (!newAmt || newAmt <= 0) throw new Error('El monto debe ser mayor a cero.');
      record.totalDebt += (newAmt - entry.amount);
      entry.amount = newAmt;
    }
    if (note !== undefined) entry.note = String(note || '').trim();
    if (date !== undefined) entry.date = date;
    await _investorWrite(record);
    return record;
  },

  /** Remove an investment-type history entry and subtract its amount from totalDebt. */
  async deleteInvestmentEntry(entryId) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const idx = record.history.findIndex(e => e.id === entryId);
    if (idx === -1) throw new Error(`Entrada de historial no encontrada: ${entryId}`);
    const entry = record.history[idx];
    if (entry.type !== 'investment') throw new Error('Solo entradas de tipo inversión se pueden eliminar así.');
    record.totalDebt -= entry.amount;
    record.history.splice(idx, 1);
    await _investorWrite(record);
    return record;
  },

  /** Update a history entry's referenceId without changing amounts. */
  async patchHistoryRef(entryId, referenceId) {
    const record = await _investorRead();
    if (!record) throw new Error('No existe un registro de inversionista.');
    const entry = record.history.find(e => e.id === entryId);
    if (!entry) throw new Error(`Entrada de historial no encontrada: ${entryId}`);
    entry.referenceId = referenceId;
    await _investorWrite(record);
    return record;
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

/**
 * Atomically apply an inventory delta and write the corresponding movement
 * row inside a single Postgres transaction (RPC apply_inventory_movement).
 * Returns the updated inventory_items row mapped to the JS shape.
 *
 * Sign convention preserved by the RPC matches the previous JS code:
 *   type='in'         → movements.quantity = +abs(delta)
 *   type='out'        → movements.quantity = -abs(delta)
 *   type='adjustment' → movements.quantity = signed delta
 */
async function _applyMovement(itemId, type, delta, referenceId, note) {
  const { data, error } = await _sb.rpc('apply_inventory_movement', {
    p_item_id:       String(itemId),
    p_delta:         delta,
    p_movement_type: type,
    p_movement_id:   _genId('mov'),
    p_reference_id:  referenceId == null ? null : String(referenceId),
    p_note:          (note || '').trim(),
  });
  if (error) throw new Error(error.message);
  // PostgREST returns the row directly when the function returns a composite.
  return Array.isArray(data) ? data[0] : data;
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
    const qty = Number(quantity);
    if (!qty || qty <= 0) throw new Error('La cantidad debe ser mayor que cero.');
    const updated = await _applyMovement(itemId, 'in', qty, referenceId, note);
    return _invItemFromDb(updated);
  },

  async removeStock(itemId, quantity, referenceId = null, note = '') {
    const qty = Number(quantity);
    if (!qty || qty <= 0) throw new Error('La cantidad debe ser mayor que cero.');
    const updated = await _applyMovement(itemId, 'out', -qty, referenceId, note);
    return _invItemFromDb(updated);
  },

  async adjustStock(itemId, quantity, note = '') {
    const qty = Number(quantity);
    if (qty === 0 || isNaN(qty)) throw new Error('La cantidad de ajuste no puede ser cero.');
    const updated = await _applyMovement(itemId, 'adjustment', qty, null, note);
    return _invItemFromDb(updated);
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
//     investor_history_id, created_at, updated_at
// JS: id, expenseDate,  category, description, amount, method, notes,
//     investorHistoryId, createdAt, updatedAt
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
    investorHistoryId: r.investor_history_id ?? null,
    isPayable:         r.is_payable === true,
    creditorType:      r.creditor_type ?? null,
    creditorId:        r.creditor_id ?? null,
    payableStatus:     r.payable_status ?? 'unpaid',
    dueDate:           r.due_date ?? null,
    paidAmount:        Number(r.paid_amount ?? 0),
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
    const now       = new Date().toISOString();
    const isPayable = Boolean(d.isPayable);
    const row = {
      id:                  _genId('exp'),
      expense_date:        d.expenseDate || d.expense_date || '',
      category:            d.category || '',
      description:         d.description || '',
      amount:              Number(d.amount) || 0,
      method:              isPayable ? null : (d.method || ''),
      notes:               d.notes || '',
      investor_history_id: isPayable ? null : (d.investorHistoryId || null),
      is_payable:          isPayable,
      creditor_type:       isPayable ? (d.creditorType || null) : null,
      creditor_id:         isPayable ? (d.creditorId   || null) : null,
      payable_status:      isPayable ? (d.payableStatus || 'unpaid') : 'unpaid',
      due_date:            isPayable ? (d.dueDate || null) : null,
      paid_amount:         isPayable ? (Number(d.paidAmount) || 0) : 0,
      created_at:          now,
      updated_at:          now,
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
    if (d.notes              !== undefined) u.notes               = d.notes;
    if (d.investorHistoryId  !== undefined) u.investor_history_id = d.investorHistoryId || null;
    if (d.isPayable          !== undefined) u.is_payable          = Boolean(d.isPayable);
    if (d.creditorType       !== undefined) u.creditor_type       = d.creditorType   || null;
    if (d.creditorId         !== undefined) u.creditor_id         = d.creditorId     || null;
    if (d.payableStatus      !== undefined) u.payable_status      = d.payableStatus  || 'unpaid';
    if (d.dueDate            !== undefined) u.due_date            = d.dueDate        || null;
    if (d.paidAmount         !== undefined) u.paid_amount         = Number(d.paidAmount) || 0;

    // Enforce mutual exclusion: AP expenses cannot be investor-linked.
    if (d.isPayable === true) {
      u.method              = null;
      u.investor_history_id = null;
    } else if (d.isPayable === false) {
      u.creditor_type  = null;
      u.creditor_id    = null;
      u.payable_status = 'unpaid';
      u.due_date       = null;
      u.paid_amount    = 0;
    }

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
// SERVICE PROVIDERS (creditors used in Gastos — Cuentas por Pagar)
//
// DB: id, name, phone, notes, is_active, created_at, updated_at
// JS: id, name, phone, notes, isActive,  createdAt,  updatedAt
//
// Distinct from the `providers` table (which is for raw-material suppliers).
// =============================================================================

function _serviceProviderFromDb(r) {
  return {
    id:        r.id,
    name:      r.name,
    phone:     r.phone || '',
    notes:     r.notes || '',
    isActive:  r.is_active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const ServiceProvidersAPI = {
  async getAll() {
    const { data, error } = await _sb.from('service_providers')
      .select('*').order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(_serviceProviderFromDb);
  },

  async create(d) {
    const row = {
      id:         _genId('sp'),
      name:       (d.name || '').trim(),
      phone:      (d.phone || '').trim() || null,
      notes:      (d.notes || '').trim() || null,
      is_active:  true,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await _sb.from('service_providers')
      .insert(row).select().single();
    if (error) throw new Error(error.message);
    return _serviceProviderFromDb(data);
  },

  async update(id, d) {
    const u = { updated_at: new Date().toISOString() };
    if (d.name     !== undefined) u.name      = (d.name || '').trim();
    if (d.phone    !== undefined) u.phone     = (d.phone || '').trim() || null;
    if (d.notes    !== undefined) u.notes     = (d.notes || '').trim() || null;
    if (d.isActive !== undefined) u.is_active = Boolean(d.isActive);

    const { data, error } = await _sb.from('service_providers').update(u)
      .eq('id', String(id)).select().single();
    if (error) throw new Error(error.message);
    return _serviceProviderFromDb(data);
  },

  async deactivate(id) { return this.update(id, { isActive: false }); },
  async activate(id)   { return this.update(id, { isActive: true  }); },
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
   * @param {string} entry.entity_type    - 'product' | 'machine' | 'sale' | 'customer' | 'expense' | etc.
   * @param {string} entry.entity_id      - Record ID
   * @param {string} entry.entity_name    - Human-readable name
   * @param {string} entry.action         - 'crear' | 'editar' | 'activar' | 'desactivar' |
   *                                        'eliminar' | 'confirmar' | 'rechazar' | 'recibir' | etc.
   * @param {Object} [entry.changes]      - { field: { before, after } }
   * @param {string} [entry.user_id]
   * @param {string} [entry.user_name]
   * @param {string} [entry.source='capflow']  - 'capflow' | 'capdispatch' | 'sistema'
   * @param {string} [entry.description]  - Mensaje pre-generado opcional.
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
        source:      entry.source      ?? 'capflow',
        description: entry.description ?? null,
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
