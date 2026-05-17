/**
 * investor-payouts.js — CapFlow Entregas a Borbón
 *
 * UI for the "Universal Investor Cut" payout ledger.
 *
 * Business rule
 * -------------
 * Every manufactured-cap package sold (to ANY customer) generates two
 * fixed amounts:
 *   • RD$100  amortiza la deuda con el inversionista (Borbón) →
 *             se aplica de inmediato sobre investor.total_debt al crear
 *             la venta confirmada (lo emite SalesAPI internamente).
 *   • RD$100  queda como "beneficio" físico pendiente de entregar a
 *             Borbón → se acumula en la tabla investor_payouts.
 *
 * Adicionalmente, para ventas NO a Borbón, se agrega al registro
 * pendiente un tercer concepto: margen reventa = (unitPrice − 735)/pkg
 * (clamp ≥ 0). Esto representa el sobreprecio por encima del mayorista
 * que la fábrica adeuda físicamente a Borbón.
 *
 * Constantes (definidas en js/api.js):
 *   INVESTOR_AMORTIZATION_PER_PKG = 100
 *   INVESTOR_BENEFIT_PER_PKG      = 100
 *   WHOLESALE_PRICE_PER_PKG       = 735
 *
 * Este módulo solo gestiona el estado físico de la entrega (pendiente vs.
 * entregado). NO altera investor.total_debt — eso es responsabilidad
 * de SalesAPI al crear / editar / eliminar la venta original.
 *
 * Data source: api.js → InvestorPayoutsAPI / SalesAPI / CustomersAPI.
 *
 * All visible text: Spanish  |  All code identifiers: English
 */

import {
  InvestorPayoutsAPI,
  SalesAPI,
  CustomersAPI,
  ProductsAPI,
  ChangeHistoryAPI,
  INVESTOR_AMORTIZATION_PER_PKG,
} from '../api.js';
import { AuthAPI } from '../auth.js';

// ─── Module State ─────────────────────────────────────────────────────────────

let _currentAdmin   = { id: null, name: 'Sistema' };
let allPayouts      = [];
let allSales        = [];
let allCustomers    = [];
let customerIndex   = new Map();
let saleIndex       = new Map();
let productIndex    = new Map();

let filterStatus    = 'pending';
let filterFrom      = '';
let filterTo        = '';
let filterCustomer  = 'all';
let searchQuery     = '';

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function mountInvestorPayouts(container) {
  container.innerHTML = buildShellHTML();
  injectStyles();
  try {
    const session = await AuthAPI.getSession();
    _currentAdmin = {
      id:   session?.user?.id    ?? null,
      name: session?.user?.email ?? 'Sistema',
    };
  } catch { /* anon mode */ }
  attachListeners();
  await loadAll();
}

// ─── HTML Shell ───────────────────────────────────────────────────────────────

function buildShellHTML() {
  return `
  <section class="module" id="payouts-module">

    <header class="module-header">
      <div class="module-header__left">
        <span class="module-header__icon">◆</span>
        <div>
          <h1 class="module-header__title">Entregas a Borbón</h1>
          <p class="module-header__subtitle">Beneficio pendiente + margen reventa por venta manufacturada</p>
        </div>
      </div>
      <div class="module-header__badge" id="payouts-count-badge">— pagos</div>
    </header>

    <!-- Summary cards (totales sobre los pagos pendientes) -->
    <div class="payouts-summary">
      <div class="payouts-summary-card payouts-summary-card--revenue">
        <span class="payouts-summary-card__label">Cobrado por operarios (pendientes)</span>
        <span class="payouts-summary-card__value" id="payouts-stat-charged-total">RD$ 0.00</span>
        <span class="payouts-summary-card__hint" id="payouts-stat-charged-hint">— paquetes</span>
      </div>
      <div class="payouts-summary-card payouts-summary-card--amort">
        <span class="payouts-summary-card__label">Amortización aplicada (pendientes)</span>
        <span class="payouts-summary-card__value" id="payouts-stat-amort-total">RD$ 0.00</span>
        <span class="payouts-summary-card__hint">RD$100 / paquete</span>
      </div>
      <div class="payouts-summary-card payouts-summary-card--pending">
        <span class="payouts-summary-card__label">A entregar a Borbón (pendientes)</span>
        <span class="payouts-summary-card__value" id="payouts-stat-pending-total">RD$ 0.00</span>
        <span class="payouts-summary-card__hint" id="payouts-stat-pending-count">0 pagos</span>
      </div>
      <div class="payouts-summary-card payouts-summary-card--delivered">
        <span class="payouts-summary-card__label">Entregado a Borbón este mes</span>
        <span class="payouts-summary-card__value" id="payouts-stat-delivered-month">RD$ 0.00</span>
      </div>
    </div>

    <!-- Filters + Table -->
    <div class="card" id="payouts-table-card">
      <div class="card__header">
        <h2 class="card__title">
          <span class="card__title-icon">▤</span> Lista de entregas
        </h2>
        <div class="table-controls">
          <div class="select-wrapper">
            <select class="form-input form-select form-input--sm"
              id="payouts-filter-status" aria-label="Filtrar por estado">
              <option value="pending">Pendientes</option>
              <option value="delivered">Entregadas</option>
              <option value="all">Todos los estados</option>
            </select>
          </div>
          <input class="form-input form-input--sm" type="date"
            id="payouts-filter-from" aria-label="Desde">
          <input class="form-input form-input--sm" type="date"
            id="payouts-filter-to" aria-label="Hasta">
          <div class="select-wrapper">
            <select class="form-input form-select form-input--sm"
              id="payouts-filter-customer" aria-label="Filtrar por cliente">
              <option value="all">Todos los clientes</option>
            </select>
          </div>
          <input class="form-input form-input--sm" type="search"
            id="payouts-search" placeholder="Buscar factura…" aria-label="Buscar">
        </div>
      </div>

      <div class="table-loading" id="payouts-loading">
        <div class="spinner"></div><span>Cargando…</span>
      </div>
      <div class="table-empty" id="payouts-empty" style="display:none;">
        <span class="table-empty__icon">◆</span>
        <p>No hay entregas que mostrar.</p>
        <p class="table-empty__sub">Las entregas se generan automáticamente al registrar ventas manufacturadas a clientes que no son Borbón.</p>
      </div>
      <div class="table-wrapper" id="payouts-wrapper" style="display:none;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha venta</th>
              <th>Factura</th>
              <th>Cliente</th>
              <th class="text-right">Paquetes</th>
              <th class="text-right">Cobrado</th>
              <th class="text-right">Amortización</th>
              <th class="text-right">A Borbón</th>
              <th class="text-right" title="Desglose de lo adeudado a Borbón">Beneficio · Margen</th>
              <th class="text-center">Estado</th>
              <th class="text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="payouts-tbody"></tbody>
        </table>
      </div>
    </div>

  </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadAll() {
  showTableLoading(true);
  try {
    const [payouts, sales, customers, products] = await Promise.all([
      InvestorPayoutsAPI.list(),
      SalesAPI.getAll(),
      CustomersAPI.getAll(),
      ProductsAPI.getAll().catch(() => []),
    ]);
    allPayouts    = payouts;
    allSales      = sales;
    allCustomers  = customers;
    saleIndex     = new Map(sales.map(s => [String(s.id), s]));
    customerIndex = new Map(customers.map(c => [String(c.id), c]));
    productIndex  = new Map(products.map(p => [String(p.id), p]));

    populateCustomerFilter();
    renderSummary();
    applyFilters();
  } catch (err) {
    showFeedback(`Error al cargar entregas: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

function populateCustomerFilter() {
  const sel  = document.getElementById('payouts-filter-customer');
  if (!sel) return;
  const prev = sel.value;
  // Only customers that actually have payouts
  const customerIds = new Set();
  for (const p of allPayouts) {
    const s = saleIndex.get(String(p.saleId));
    if (s) customerIds.add(String(s.clientId));
  }
  sel.innerHTML = '<option value="all">Todos los clientes</option>';
  for (const id of customerIds) {
    const c = customerIndex.get(id);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = c ? c.name : `[Cliente ${id}]`;
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function renderSummary() {
  const pending = allPayouts.filter(p => p.status === 'pending');

  const pendingTotal = pending.reduce((s, p) => s + (p.totalOwed || 0), 0);
  const pendingPkgs  = pending.reduce((s, p) => s + (p.packagesTotal || 0), 0);
  const pendingAmort = pendingPkgs * INVESTOR_AMORTIZATION_PER_PKG;
  const pendingCharged = pending.reduce(
    (s, p) => s + chargedForPayout(p), 0
  );

  const monthKey = todayString().slice(0, 7);
  const deliveredMonth = allPayouts
    .filter(p => p.status === 'delivered'
      && (p.deliveredAt || '').slice(0, 7) === monthKey)
    .reduce((s, p) => s + (p.totalOwed || 0), 0);

  setText('payouts-stat-charged-total',    formatCurrency(pendingCharged));
  setText('payouts-stat-charged-hint',     `${pendingPkgs} paquetes`);
  setText('payouts-stat-amort-total',      formatCurrency(pendingAmort));
  setText('payouts-stat-pending-total',    formatCurrency(pendingTotal));
  setText('payouts-stat-pending-count',    `${pending.length} pagos`);
  setText('payouts-stat-delivered-month',  formatCurrency(deliveredMonth));
}

// Sum unitPrice*quantity across manufactured lines of the payout's sale.
function chargedForPayout(p) {
  const sale = saleIndex.get(String(p.saleId));
  if (!sale) return 0;
  return (sale.lines || []).reduce((s, l) => {
    if (l.productType !== 'manufactured') return s;
    const qty = Number(l.quantity) || 0;
    if (qty <= 0) return s;
    return s + qty * (Number(l.unitPrice) || 0);
  }, 0);
}

// ─── Filters + Table ──────────────────────────────────────────────────────────

function attachListeners() {
  document.getElementById('payouts-filter-status')
    ?.addEventListener('change', e => { filterStatus   = e.target.value; applyFilters(); });
  document.getElementById('payouts-filter-from')
    ?.addEventListener('change', e => { filterFrom     = e.target.value; applyFilters(); });
  document.getElementById('payouts-filter-to')
    ?.addEventListener('change', e => { filterTo       = e.target.value; applyFilters(); });
  document.getElementById('payouts-filter-customer')
    ?.addEventListener('change', e => { filterCustomer = e.target.value; applyFilters(); });
  document.getElementById('payouts-search')
    ?.addEventListener('input', e => {
      searchQuery = (e.target.value || '').trim().toLowerCase();
      applyFilters();
    });
}

function applyFilters() {
  let rows = allPayouts;
  if (filterStatus !== 'all') {
    rows = rows.filter(p => p.status === filterStatus);
  }
  if (filterFrom) rows = rows.filter(p => (p.saleDate || '') >= filterFrom);
  if (filterTo)   rows = rows.filter(p => (p.saleDate || '') <= filterTo);
  if (filterCustomer !== 'all') {
    rows = rows.filter(p => {
      const s = saleIndex.get(String(p.saleId));
      return s && String(s.clientId) === String(filterCustomer);
    });
  }
  if (searchQuery) {
    rows = rows.filter(p => {
      const s = saleIndex.get(String(p.saleId));
      const inv = (s?.invoiceNumber || '').toLowerCase();
      const customer = (customerIndex.get(String(s?.clientId))?.name || '').toLowerCase();
      return inv.includes(searchQuery) || customer.includes(searchQuery);
    });
  }
  rows = [...rows].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));

  const badge = document.getElementById('payouts-count-badge');
  if (badge) {
    badge.textContent = rows.length === allPayouts.length
      ? `${allPayouts.length} pagos`
      : `${rows.length} de ${allPayouts.length} pagos`;
  }
  renderTable(rows);
}

function renderTable(rows) {
  showTableLoading(false);
  const tbody   = document.getElementById('payouts-tbody');
  const empty   = document.getElementById('payouts-empty');
  const wrapper = document.getElementById('payouts-wrapper');
  if (!rows || rows.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }
  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = rows.map(buildRow).join('');

  tbody.querySelectorAll('[data-action="deliver"]').forEach(btn =>
    btn.addEventListener('click', () => openDeliverModal(btn.dataset.id))
  );
  tbody.querySelectorAll('[data-action="revert"]').forEach(btn =>
    btn.addEventListener('click', () => handleRevert(btn.dataset.id))
  );
  tbody.querySelectorAll('[data-action="view-sale"]').forEach(btn =>
    btn.addEventListener('click', () => openSaleModal(btn.dataset.id))
  );
}

function buildRow(p) {
  const sale     = saleIndex.get(String(p.saleId));
  const customer = sale ? customerIndex.get(String(sale.clientId)) : null;
  const customerName = customer
    ? escapeHTML(customer.name)
    : '<em style="color:var(--color-text-muted);">[Cliente eliminado]</em>';
  const invNumber = sale?.invoiceNumber || p.saleId;

  const statusBadge = p.status === 'delivered'
    ? `<span class="badge payouts-badge-delivered" title="${escapeHTML(p.deliveredNote || '')}">
         ✓ Entregado
       </span>`
    : `<span class="badge payouts-badge-pending">⏳ Pendiente</span>`;

  const actions = p.status === 'pending'
    ? `<button class="btn btn--primary btn--xs" data-action="deliver" data-id="${escapeHTML(p.id)}">
         ✓ Marcar entregado
       </button>
       <button class="btn btn--ghost btn--xs" data-action="view-sale" data-id="${escapeHTML(p.saleId)}" title="Ver venta original">
         ▤ Ver venta
       </button>`
    : `<button class="btn btn--ghost btn--xs" data-action="revert" data-id="${escapeHTML(p.id)}" title="Revertir a pendiente">
         ↺ Revertir entrega
       </button>
       <button class="btn btn--ghost btn--xs" data-action="view-sale" data-id="${escapeHTML(p.saleId)}" title="Ver venta original">
         ▤ Ver venta
       </button>`;

  const charged      = chargedForPayout(p);
  const amortization = (p.packagesTotal || 0) * INVESTOR_AMORTIZATION_PER_PKG;

  return `
    <tr class="table-row">
      <td>${escapeHTML(formatDate(p.saleDate))}</td>
      <td>${escapeHTML(invNumber)}</td>
      <td>${customerName}</td>
      <td class="text-right">${p.packagesTotal}</td>
      <td class="text-right payouts-cell-emph">${formatCurrency(charged)}</td>
      <td class="text-right payouts-cell-emph payouts-cell-amort">${formatCurrency(amortization)}</td>
      <td class="text-right payouts-cell-emph payouts-cell-borbon">${formatCurrency(p.totalOwed)}</td>
      <td class="text-right" style="font-size:0.82rem;color:var(--color-text-muted);white-space:nowrap;">
        ${formatCurrency(p.benefitTotal)} · ${formatCurrency(p.marginTotal)}
      </td>
      <td class="text-center">${statusBadge}</td>
      <td class="text-center" style="white-space:nowrap;">${actions}</td>
    </tr>
  `;
}

// ─── Deliver / Revert ─────────────────────────────────────────────────────────

function openDeliverModal(payoutId) {
  const payout = allPayouts.find(p => String(p.id) === String(payoutId));
  if (!payout) return;

  document.getElementById('payouts-deliver-backdrop')?.remove();

  const sale     = saleIndex.get(String(payout.saleId));
  const customer = sale ? customerIndex.get(String(sale.clientId)) : null;
  const invLabel = sale?.invoiceNumber || payout.saleId;

  const backdrop = document.createElement('div');
  backdrop.id        = 'payouts-deliver-backdrop';
  backdrop.className = 'ar-modal-backdrop';
  backdrop.innerHTML = `
    <div class="ar-modal" role="dialog" aria-modal="true" style="max-width:480px;">
      <div class="ar-modal__header">
        <h3 class="ar-modal__title">
          <span style="color:var(--color-primary,#6c63ff);">◆</span>
          Confirmar entrega a Borbón
        </h3>
        <button class="ar-modal__close" id="payouts-deliver-close" type="button">✕</button>
      </div>

      <div style="padding:var(--space-md) var(--space-lg);display:flex;flex-direction:column;gap:var(--space-sm);">
        <div style="font-size:0.875rem;color:var(--color-text-muted);">
          Venta <strong style="color:var(--color-text);">${escapeHTML(invLabel)}</strong>
          ${customer ? `· ${escapeHTML(customer.name)}` : ''}
          · ${escapeHTML(formatDate(payout.saleDate))}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.95rem;
          padding:var(--space-sm) var(--space-md);
          background:var(--color-surface-secondary,var(--color-surface));
          border:1px solid var(--color-border);border-radius:var(--radius-sm);">
          <span>Total a entregar</span>
          <strong>${formatCurrency(payout.totalOwed)}</strong>
        </div>
        <div style="font-size:0.8rem;color:var(--color-text-muted);">
          Beneficio: ${formatCurrency(payout.benefitTotal)} ·
          Margen reventa: ${formatCurrency(payout.marginTotal)} ·
          Paquetes: ${payout.packagesTotal}
        </div>

        <form id="payouts-deliver-form" novalidate>
          <div class="form-group" style="margin-top:var(--space-sm);">
            <label class="form-label" for="payouts-deliver-date">
              Fecha de entrega <span class="required">*</span>
            </label>
            <input class="form-input" type="date" id="payouts-deliver-date"
              value="${todayString()}" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="payouts-deliver-note">Nota (opcional)</label>
            <input class="form-input" type="text" id="payouts-deliver-note"
              placeholder="Forma de entrega, referencia…" maxlength="200">
          </div>
          <div style="display:flex;justify-content:flex-end;gap:var(--space-sm);margin-top:var(--space-md);">
            <button type="button" class="btn btn--ghost btn--sm" id="payouts-deliver-cancel">
              Cancelar
            </button>
            <button type="submit" class="btn btn--primary btn--sm" id="payouts-deliver-submit">
              ✓ Confirmar entrega
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#payouts-deliver-close').addEventListener('click', close);
  backdrop.querySelector('#payouts-deliver-cancel').addEventListener('click', close);

  backdrop.querySelector('#payouts-deliver-form')
    .addEventListener('submit', async e => {
      e.preventDefault();
      const date = document.getElementById('payouts-deliver-date').value;
      const note = document.getElementById('payouts-deliver-note').value.trim();
      if (!date) return;
      const submitBtn = document.getElementById('payouts-deliver-submit');
      setButtonLoading(submitBtn, true);
      try {
        await markDelivered(payout, date, note);
        close();
        showFeedback('Entrega registrada correctamente.', 'success');
        await loadAll();
      } catch (err) {
        showFeedback(`Error al registrar entrega: ${err.message}`, 'error');
        setButtonLoading(submitBtn, false);
      }
    });
}

async function markDelivered(payout, date, note) {
  // ISO timestamp at noon UTC for the chosen calendar day.
  const deliveredAt = new Date(`${date}T12:00:00Z`).toISOString();
  const updated = await InvestorPayoutsAPI.markDelivered(payout.id, {
    deliveredAt,
    deliveredNote: note || null,
  });

  const sale     = saleIndex.get(String(payout.saleId));
  const invLabel = sale?.invoiceNumber || payout.saleId;
  ChangeHistoryAPI.log({
    entity_type: 'investor_payout',
    entity_id:   payout.id,
    entity_name: `Venta ${invLabel}`,
    action:      'entregar',
    changes: {
      estado:       { before: 'pending', after: 'delivered' },
      fecha:        { before: null, after: date },
      nota:         { before: null, after: note || null },
      total_entregado: { before: null, after: payout.totalOwed },
    },
    user_id:   _currentAdmin.id,
    user_name: _currentAdmin.name,
  });
  return updated;
}

async function handleRevert(payoutId) {
  const payout = allPayouts.find(p => String(p.id) === String(payoutId));
  if (!payout) return;
  if (!window.confirm('¿Revertir esta entrega a pendiente?')) return;

  try {
    await InvestorPayoutsAPI.revertDelivery(payout.id);
    const sale     = saleIndex.get(String(payout.saleId));
    const invLabel = sale?.invoiceNumber || payout.saleId;
    ChangeHistoryAPI.log({
      entity_type: 'investor_payout',
      entity_id:   payout.id,
      entity_name: `Venta ${invLabel}`,
      action:      'revertir',
      changes: {
        estado: { before: 'delivered', after: 'pending' },
      },
      user_id:   _currentAdmin.id,
      user_name: _currentAdmin.name,
    });
    showFeedback('Entrega revertida a pendiente.', 'success');
    await loadAll();
  } catch (err) {
    showFeedback(`Error al revertir: ${err.message}`, 'error');
  }
}

function openSaleModal(saleId) {
  const sale = saleIndex.get(String(saleId));
  if (!sale) {
    showFeedback('La venta original ya no existe.', 'error');
    return;
  }
  document.getElementById('payouts-sale-backdrop')?.remove();

  const customer    = customerIndex.get(String(sale.clientId));
  const customerLbl = customer ? customer.name : `[Cliente ${sale.clientId}]`;
  const invLabel    = sale.invoiceNumber || sale.id;
  const lines       = Array.isArray(sale.lines) ? sale.lines : [];
  const totals      = sale.totals || {};

  const paymentLabel = sale.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo';
  const statusLabel  = ({
    confirmed:      'Confirmada',
    pending_review: 'Pendiente de revisión',
    cancelled:      'Cancelada',
  })[sale.status] || sale.status || '—';

  const linesHTML = lines.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);padding:var(--space-md);">Sin líneas.</td></tr>`
    : lines.map(l => {
        const prod    = productIndex.get(String(l.productId));
        const name    = prod ? prod.name : `[Producto ${l.productId}]`;
        const type    = l.productType === 'resale' ? 'Reventa' : 'Manufacturado';
        const qty     = Number(l.quantity) || 0;
        const price   = Number(l.unitPrice) || 0;
        const subtot  = Number(l.lineRevenue ?? (qty * price));
        return `
          <tr>
            <td>${escapeHTML(name)}</td>
            <td><span class="badge ${l.productType === 'resale' ? 'payouts-badge-pending' : 'payouts-badge-delivered'}">${type}</span></td>
            <td class="text-right">${qty}</td>
            <td class="text-right">${formatCurrency(price)}</td>
            <td class="text-right"><strong>${formatCurrency(subtot)}</strong></td>
          </tr>
        `;
      }).join('');

  const backdrop = document.createElement('div');
  backdrop.id        = 'payouts-sale-backdrop';
  backdrop.className = 'ar-modal-backdrop';
  backdrop.innerHTML = `
    <div class="ar-modal" role="dialog" aria-modal="true" style="max-width:760px;">
      <div class="ar-modal__header">
        <h3 class="ar-modal__title">
          <span style="color:var(--color-primary,#6c63ff);">▤</span>
          Detalle de venta ${escapeHTML(invLabel)}
        </h3>
        <button class="ar-modal__close" id="payouts-sale-close" type="button">✕</button>
      </div>

      <div style="padding:var(--space-md) var(--space-lg);display:flex;flex-direction:column;gap:var(--space-md);">

        <div class="payouts-sale-meta">
          <div><span class="payouts-sale-meta__label">Fecha</span><span>${escapeHTML(formatDate(sale.saleDate))}</span></div>
          <div><span class="payouts-sale-meta__label">Cliente</span><span>${escapeHTML(customerLbl)}</span></div>
          <div><span class="payouts-sale-meta__label">Operario</span><span>${escapeHTML(sale.operatorName || '—')}</span></div>
          <div><span class="payouts-sale-meta__label">Método de pago</span><span>${escapeHTML(paymentLabel)}</span></div>
          <div><span class="payouts-sale-meta__label">Estado</span><span>${escapeHTML(statusLabel)}</span></div>
          <div><span class="payouts-sale-meta__label">ID interno</span><span style="font-family:monospace;font-size:0.85em;">${escapeHTML(sale.id)}</span></div>
        </div>

        ${sale.notes ? `
          <div style="font-size:0.875rem;padding:var(--space-sm) var(--space-md);
            background:var(--color-surface-secondary,var(--color-surface));
            border-left:3px solid var(--color-primary,#6c63ff);
            border-radius:var(--radius-sm);">
            <strong>Notas:</strong> ${escapeHTML(sale.notes)}
          </div>
        ` : ''}

        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Tipo</th>
                <th class="text-right">Cantidad</th>
                <th class="text-right">P. unitario</th>
                <th class="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>${linesHTML}</tbody>
          </table>
        </div>

        <div class="payouts-sale-totals">
          <div><span>Ingreso</span><strong>${formatCurrency(totals.revenue)}</strong></div>
          <div><span>Costo</span><strong>${formatCurrency(totals.cost)}</strong></div>
          <div><span>Utilidad</span><strong style="color:${Number(totals.profit) >= 0 ? 'var(--color-success,#38a169)' : 'var(--color-danger,#e53e3e)'};">${formatCurrency(totals.profit)}</strong></div>
        </div>

        <div style="display:flex;justify-content:flex-end;">
          <button type="button" class="btn btn--primary btn--sm" id="payouts-sale-ok">Cerrar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#payouts-sale-close').addEventListener('click', close);
  backdrop.querySelector('#payouts-sale-ok').addEventListener('click', close);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showTableLoading(loading) {
  document.getElementById('payouts-loading').style.display = loading ? 'flex' : 'none';
  document.getElementById('payouts-wrapper').style.display = loading ? 'none' : '';
  document.getElementById('payouts-empty').style.display   = 'none';
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function todayString() { return new Date().toISOString().slice(0, 10); }

function formatDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function formatCurrency(n) {
  return 'RD$ ' + new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n || 0);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function showFeedback(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✔', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${icons[type] ?? 'ℹ'}</span>
    <span class="toast__message">${escapeHTML(message)}</span>
    <span class="toast__close" aria-label="Cerrar">&times;</span>
  `;
  const dismiss = () => {
    if (toast.classList.contains('toast--exiting')) return;
    toast.classList.add('toast--exiting');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.addEventListener('click', dismiss);
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.dataset.originalText = btn.dataset.originalText || btn.innerHTML;
  btn.innerHTML = loading
    ? '<span class="spinner spinner--sm"></span> Guardando…'
    : btn.dataset.originalText;
}

// ─── Scoped Styles ────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('payouts-module-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'payouts-module-styles';
  tag.textContent = `
    .payouts-summary {
      display: grid; gap: var(--space-md);
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-bottom: var(--space-lg);
    }
    .payouts-summary-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-md) var(--space-lg);
      display: flex; flex-direction: column; gap: 4px;
    }
    .payouts-summary-card__label {
      font-size: 0.78rem; color: var(--color-text-muted);
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .payouts-summary-card__value {
      font-size: 1.4rem; font-weight: 700; color: var(--color-text);
    }
    .payouts-summary-card__hint {
      font-size: 0.72rem; color: var(--color-text-muted);
      margin-top: 2px;
    }
    .payouts-summary-card--revenue {
      border-left: 4px solid var(--color-primary, #6c63ff);
    }
    .payouts-summary-card--amort {
      border-left: 4px solid var(--color-info, #4299e1);
    }
    .payouts-summary-card--pending {
      border-left: 4px solid var(--color-warning, #f6ad55);
    }
    .payouts-summary-card--delivered {
      border-left: 4px solid var(--color-success, #38a169);
    }

    .payouts-cell-emph { font-weight: 600; }
    .payouts-cell-amort  { color: var(--color-info, #2b6cb0); }
    .payouts-cell-borbon { color: var(--color-warning, #c05621); }

    .payouts-badge-pending {
      background: color-mix(in srgb, var(--color-warning, #f6ad55) 15%, transparent);
      color: var(--color-warning, #c05621);
      border: 1px solid color-mix(in srgb, var(--color-warning, #f6ad55) 40%, transparent);
    }
    .payouts-badge-delivered {
      background: color-mix(in srgb, var(--color-success, #38a169) 15%, transparent);
      color: var(--color-success, #2f855a);
      border: 1px solid color-mix(in srgb, var(--color-success, #38a169) 40%, transparent);
    }

    .payouts-sale-meta {
      display: grid; gap: var(--space-sm) var(--space-lg);
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      padding: var(--space-sm) var(--space-md);
      background: var(--color-surface-secondary, var(--color-surface));
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
    }
    .payouts-sale-meta > div {
      display: flex; flex-direction: column; gap: 2px;
    }
    .payouts-sale-meta__label {
      font-size: 0.72rem; color: var(--color-text-muted);
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .payouts-sale-totals {
      display: grid; gap: var(--space-md);
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      padding: var(--space-sm) var(--space-md);
      border-top: 1px solid var(--color-border);
    }
    .payouts-sale-totals > div {
      display: flex; flex-direction: column; gap: 2px; text-align: right;
    }
    .payouts-sale-totals span {
      font-size: 0.78rem; color: var(--color-text-muted);
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .payouts-sale-totals strong { font-size: 1.1rem; }

    /* Modal — duplicated from sales.js so this module is self-contained. */
    .ar-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 2000; padding: var(--space-md);
    }
    .ar-modal {
      background: var(--color-bg-card, var(--color-surface));
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      width: 100%; max-width: 680px;
      max-height: 90vh; overflow-y: auto;
      display: flex; flex-direction: column;
      box-shadow: 0 24px 64px rgba(0,0,0,0.45);
    }
    .ar-modal__header {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding: var(--space-lg) var(--space-xl);
      border-bottom: 1px solid var(--color-border);
      gap: var(--space-md);
    }
    .ar-modal__title {
      margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text);
    }
    .ar-modal__close {
      background: none; border: none;
      color: var(--color-text-muted); font-size: 1.15rem;
      cursor: pointer; padding: 4px 8px; flex-shrink: 0;
      border-radius: var(--radius-sm);
      transition: background .15s, color .15s;
    }
    .ar-modal__close:hover {
      background: var(--color-surface); color: var(--color-text);
    }
  `;
  document.head.appendChild(tag);
}
