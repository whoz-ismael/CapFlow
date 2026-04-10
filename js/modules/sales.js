/**
 * sales.js — CapFlow Sales / Facturación Module
 *
 * Manages sale transactions:
 *   • Multi-line sale items (manufactured + resale products)
 *   • Attachment upload (PDF / image) stored as base64 DataURL
 *   • Automatic inventory deduction for manufactured lines via InventoryAPI
 *   • Monthly cost-per-package snapshot for manufactured lines
 *   • Safe edit (delta re-balance) and delete (full stock return)
 *   • Accounts Receivable (AR) — payment tracking per sale via SalePaymentsAPI
 *
 * Investor pricing (auto-applied when selected client is the investor):
 *   • RD$100/pkg benefit discount on every manufactured line (always)
 *   • RD$100/pkg debt paydown on manufactured lines while debt > 0
 *   • On create: InvestorAPI.setSaleAmortization records the paydown
 *   • On edit:   setSaleAmortization reconciles old vs new amount
 *   • On delete: clearSaleAmortization reverses the paydown
 *   History is never deleted — every adjustment is auditable.
 *
 * Inventory rules:
 *   CREATE  → removeStock per manufactured line
 *   EDIT    → delta = newQty − oldQty per inventory item
 *   DELETE  → addStock (full return) per manufactured line
 *   RESALE  → no inventory touches
 *
 * AR rules:
 *   • Payments are recorded against a sale via SalePaymentsAPI
 *   • Status = 'paid' when total payments ≥ sale revenue
 *   • Status = 'partial' when 0 < payments < revenue
 *   • Status = 'unpaid' when no payments
 *   • Deleting a sale also removes all its payments (removeBySaleId)
 *
 * All visible text: Spanish  |  All code identifiers: English
 */

import { SalesAPI }                   from '../api.js';
import { CustomersAPI }               from '../api.js';
import { ProductsAPI }                from '../api.js';
import { InventoryAPI }               from '../api.js';
import { ensureProductInventoryItem } from '../api.js';
import { ProductionAPI }              from '../api.js';
import { RawMaterialsAPI }            from '../api.js';
import { MonthlyInventoryAPI }        from '../api.js';
import { InvestorAPI }                from '../api.js';
import { SalePaymentsAPI }            from '../api.js';
import { nextInvoiceNumber }          from '../api.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixed RD$ discount applied per manufactured package as investor benefit. */
const INVESTOR_BENEFIT_PER_PKG = 100;

/** Fixed RD$ debt paydown per manufactured package (while debt > 0). */
const INVESTOR_PAYDOWN_PER_PKG = 100;

/** Payment methods available in the AR form. */
const PAYMENT_METHODS = [
  { value: 'efectivo',      label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'otro',          label: 'Otro' },
];

// ─── Module State ─────────────────────────────────────────────────────────────

let editingSale      = null;
let allSales         = [];
let allClients       = [];
let allClientsIndex  = new Map();
let productMap       = new Map();

/**
 * Current investor record (InvestorAPI.get()), or null.
 * Re-fetched on every loadAll() so totalDebt is always fresh.
 * @type {Object|null}
 */
let investorRecord = null;

/** Attachments for the active form session. */
let currentAttachments = [];

let _lineSeq = 0;

let _allProduction = [];
let _allPurchases  = [];
let _allMonthlyInv = [];

/** All payment records loaded on each loadAll(). */
let _allPayments = [];
/** Map: saleId (string) → payment[] */
let _paymentsMap = new Map();

let filterMonth    = '';
let filterClientId = 'all';
let searchQuery    = '';

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function mountSales(container) {
  container.innerHTML = buildShellHTML();
  injectStyles();
  attachListeners();
  await loadAll();
}

// ─── HTML Shell ───────────────────────────────────────────────────────────────

function buildShellHTML() {
  const today = todayString();
  return `
  <section class="module" id="sales-module">

    <header class="module-header">
      <div class="module-header__left">
        <span class="module-header__icon">▤</span>
        <div>
          <h1 class="module-header__title">Facturación</h1>
          <p class="module-header__subtitle">Registro de ventas y control de stock</p>
        </div>
      </div>
      <div class="module-header__badge" id="sales-count-badge">— ventas</div>
    </header>

    <!-- ── Create / Edit Form ── -->
    <div class="card" id="sales-form-card">
      <div class="card__header">
        <h2 class="card__title" id="sales-form-title">
          <span class="card__title-icon">+</span> Nueva Venta
        </h2>
        <button class="btn btn--ghost btn--sm" id="sales-cancel-btn" style="display:none;">
          ✕ Cancelar
        </button>
      </div>

      <form id="sales-form" novalidate>
        <input type="hidden" id="sale-field-id">

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" for="sale-field-date">
              Fecha <span class="required">*</span>
            </label>
            <input class="form-input" type="date" id="sale-field-date"
              value="${today}" required>
            <span class="form-error" id="sale-error-date"></span>
          </div>

          <div class="form-group">
            <label class="form-label" for="sale-field-client">
              Cliente <span class="required">*</span>
            </label>
            <div class="select-wrapper">
              <select class="form-input form-select" id="sale-field-client" required>
                <option value="" disabled selected>Seleccionar cliente…</option>
              </select>
            </div>
            <span class="form-error" id="sale-error-client"></span>
          </div>

          <div class="form-group">
            <label class="form-label" for="sale-field-invoice">N° Factura</label>
            <input class="form-input" type="text" id="sale-field-invoice"
              placeholder="Generando…" maxlength="40">
          </div>

          <div class="form-group form-group--wide">
            <label class="form-label" for="sale-field-notes">Notas (opcional)</label>
            <input class="form-input" type="text" id="sale-field-notes"
              placeholder="Condiciones, observaciones…" maxlength="200">
          </div>
        </div>

        <!-- Investor pricing banner — visible only when investor client selected -->
        <div id="sales-investor-banner" class="sales-investor-banner" style="display:none;">
          <span class="sales-investor-banner__icon">◇</span>
          <div class="sales-investor-banner__body">
            <strong>Precio inversionista activo</strong> —
            RD$${INVESTOR_BENEFIT_PER_PKG}/paquete (descuento beneficio fijo) +
            RD$${INVESTOR_PAYDOWN_PER_PKG}/paquete adicional como pago a deuda
            mientras haya saldo pendiente.
            Aplica únicamente a productos <em>manufacturados</em>.
            <span id="sales-investor-debt-hint" class="sales-investor-debt-hint"></span>
          </div>
        </div>

        <!-- Line Items -->
        <div class="sales-lines-section">
          <div class="sales-lines-header">
            <span class="form-label">Artículos vendidos</span>
            <button type="button" class="btn btn--ghost btn--xs" id="sales-add-line-btn">
              ＋ Agregar línea
            </button>
          </div>
          <span class="form-error" id="sale-error-lines"></span>
          <div class="sales-lines-table-wrap">
            <table class="data-table sales-lines-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="text-right">Cantidad</th>
                  <th class="text-right">Precio unit.</th>
                  <th class="text-right">Costo unit.<br>
                    <small style="font-weight:400;font-size:0.7rem;">(resale: requerido)</small>
                  </th>
                  <th class="text-right">Ingreso</th>
                  <th class="text-right">Costo total</th>
                  <th class="text-right">Ganancia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="sales-lines-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Totals Preview -->
        <div class="sales-totals-preview">
          <div class="sales-total-item">
            <span class="sales-total-label">Ingresos</span>
            <span class="sales-total-value" id="preview-revenue">RD$ 0.00</span>
          </div>
          <div class="sales-total-item">
            <span class="sales-total-label">Costos</span>
            <span class="sales-total-value" id="preview-cost">RD$ 0.00</span>
          </div>
          <div class="sales-total-item">
            <span class="sales-total-label">Ganancia</span>
            <span class="sales-total-value" id="preview-profit">RD$ 0.00</span>
          </div>
          <div class="sales-total-item">
            <span class="sales-total-label">Margen</span>
            <span class="sales-total-value" id="preview-margin">—</span>
          </div>
          <!-- Investor discount rows — shown only for investor sales -->
          <div class="sales-total-item sales-total-item--investor"
               id="inv-preview-benefit-wrap" style="display:none;">
            <span class="sales-total-label">Descuento beneficio</span>
            <span class="sales-total-value sales-total-investor" id="inv-preview-benefit">RD$ 0.00</span>
          </div>
          <div class="sales-total-item sales-total-item--investor"
               id="inv-preview-paydown-wrap" style="display:none;">
            <span class="sales-total-label">Pago a deuda</span>
            <span class="sales-total-value sales-total-investor" id="inv-preview-paydown">RD$ 0.00</span>
          </div>
        </div>

        <!-- Attachments -->
        <div class="sales-attach-section">
          <div class="sales-lines-header">
            <span class="form-label">Documentos adjuntos</span>
            <label class="btn btn--ghost btn--xs" for="sale-file-input" style="cursor:pointer;">
              ↑ Subir archivo
            </label>
            <input type="file" id="sale-file-input" accept=".pdf,image/*"
              style="display:none;" multiple>
          </div>
          <p class="form-hint">PDF o imagen. Máx. 3 archivos, 1.5 MB por archivo.</p>
          <div id="sales-attach-list" class="sales-attach-list"></div>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <button type="submit" class="btn btn--primary" id="sales-submit-btn">
            <span class="btn__icon">＋</span> Guardar Venta
          </button>
        </div>
      </form>
    </div>

    <!-- ── Filters + Table ── -->
    <div class="card" id="sales-table-card">
      <div class="card__header">
        <h2 class="card__title">
          <span class="card__title-icon">▤</span> Ventas registradas
        </h2>
        <div class="table-controls">
          <input class="form-input form-input--sm" type="month"
            id="sales-filter-month" aria-label="Filtrar por mes">
          <div class="select-wrapper">
            <select class="form-input form-select form-input--sm"
              id="sales-filter-client" aria-label="Filtrar por cliente">
              <option value="all">Todos los clientes</option>
            </select>
          </div>
          <div class="select-wrapper">
            <select class="form-input form-select form-input--sm"
              id="sales-filter-ar" aria-label="Filtrar por estado de cobro">
              <option value="all">Todos los estados</option>
              <option value="unpaid">Pendiente</option>
              <option value="partial">Parcial</option>
              <option value="paid">Cobrado</option>
            </select>
          </div>
          <input class="form-input form-input--sm" type="search"
            id="sales-search" placeholder="Buscar…" aria-label="Buscar">
        </div>
      </div>

      <div class="table-loading" id="sales-table-loading">
        <div class="spinner"></div><span>Cargando ventas…</span>
      </div>
      <div class="table-empty" id="sales-table-empty" style="display:none;">
        <span class="table-empty__icon">▤</span>
        <p>No hay ventas registradas.</p>
        <p class="table-empty__sub">Usa el formulario de arriba para registrar la primera venta.</p>
      </div>
      <div class="table-wrapper" id="sales-table-wrapper" style="display:none;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>N° Factura</th>
              <th class="text-right">Ingresos</th>
              <th class="text-right">Costos</th>
              <th class="text-right">Ganancia</th>
              <th class="text-right">Margen</th>
              <th class="text-center">Estado cobro</th>
              <th class="text-center">Adjuntos</th>
              <th class="text-center">Acciones</th>
            </tr>
          </thead>
          <tbody id="sales-tbody"></tbody>
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
    const [sales, clients, products, production, purchases, monthlyInv, investor, payments] =
      await Promise.all([
        SalesAPI.getAll(),
        CustomersAPI.getAll(),
        ProductsAPI.getAll(),
        ProductionAPI.getAll(),
        RawMaterialsAPI.getAll(),
        MonthlyInventoryAPI.getAll(),
        InvestorAPI.get().catch(() => null),
        SalePaymentsAPI.getAll().catch(() => []),
      ]);

    allSales        = sales;
    allClients      = clients.filter(c => c.status !== 'inactive');
    allClientsIndex = new Map(clients.map(c => [String(c.id), c]));
    productMap      = new Map(products.map(p => [String(p.id), p]));
    investorRecord  = investor;
    _allProduction  = production;
    _allPurchases   = purchases;
    _allMonthlyInv  = monthlyInv;

    // Build payments map
    _allPayments = payments;
    _paymentsMap = new Map();
    for (const p of payments) {
      const k = String(p.saleId);
      if (!_paymentsMap.has(k)) _paymentsMap.set(k, []);
      _paymentsMap.get(k).push(p);
    }

    populateSelect(
      'sale-field-client',
      allClients,
      c => ({ value: c.id, label: c.name }),
      'Seleccionar cliente…'
    );

    const filterClientEl = document.getElementById('sales-filter-client');
    if (filterClientEl) {
      const prev = filterClientEl.value;
      filterClientEl.innerHTML = '<option value="all">Todos los clientes</option>';
      allClients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        filterClientEl.appendChild(opt);
      });
      if (prev) filterClientEl.value = prev;
    }

    refreshInvestorBanner();
    applyFilters();

  } catch (err) {
    showFeedback(`Error al cargar datos: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// ─── AR Helpers ───────────────────────────────────────────────────────────────

/**
 * Compute the payment status of a sale from the in-memory payments map.
 * @param {string} saleId
 * @param {number} revenue
 * @returns {{ status: 'paid'|'partial'|'unpaid', paid: number, balance: number }}
 */
function getArStatus(saleId, revenue) {
  const payments = _paymentsMap.get(String(saleId)) || [];
  const paid     = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const balance  = Math.max(0, (revenue || 0) - paid);
  if (paid <= 0)       return { status: 'unpaid',  paid, balance: revenue || 0 };
  if (balance <= 0.01) return { status: 'paid',    paid, balance: 0 };
  return               { status: 'partial', paid, balance };
}

const AR_STATUS_LABEL = { paid: 'Cobrado', partial: 'Parcial', unpaid: 'Pendiente' };
const AR_STATUS_CLASS = {
  paid:    'badge--ar-paid',
  partial: 'badge--ar-partial',
  unpaid:  'badge--ar-unpaid',
};

// ─── Filters & Table ──────────────────────────────────────────────────────────

function applyFilters() {
  const month    = (document.getElementById('sales-filter-month')?.value  || '').trim();
  const clientId =  document.getElementById('sales-filter-client')?.value || 'all';
  const arFilter =  document.getElementById('sales-filter-ar')?.value     || 'all';
  const query    = (document.getElementById('sales-search')?.value        || '').trim().toLowerCase();

  filterMonth    = month;
  filterClientId = clientId;
  searchQuery    = query;

  let results = allSales;
  if (month)              results = results.filter(s => s.month === month);
  if (clientId !== 'all') results = results.filter(s => String(s.clientId) === String(clientId));
  if (arFilter !== 'all') {
    results = results.filter(s => {
      const { status } = getArStatus(s.id, (s.totals || {}).revenue);
      return status === arFilter;
    });
  }
  if (query) {
    results = results.filter(s => {
      const c = allClientsIndex.get(String(s.clientId));
      return (c?.name || '').toLowerCase().includes(query) ||
             (s.invoiceNumber || '').toLowerCase().includes(query) ||
             (s.notes || '').toLowerCase().includes(query);
    });
  }

  results = [...results].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
  updateCountBadge(allSales.length, results.length !== allSales.length ? results.length : null);
  renderTable(results);
}

function renderTable(sales) {
  showTableLoading(false);
  const tbody   = document.getElementById('sales-tbody');
  const empty   = document.getElementById('sales-table-empty');
  const wrapper = document.getElementById('sales-table-wrapper');

  if (!sales || sales.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }
  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = sales.map(s => buildSaleRow(s)).join('');

  tbody.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => handleEdit(btn.dataset.id))
  );
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.id))
  );
  tbody.querySelectorAll('[data-action="payments"]').forEach(btn =>
    btn.addEventListener('click', () => openPaymentsModal(btn.dataset.id))
  );
}

function buildSaleRow(sale) {
  const client     = allClientsIndex.get(String(sale.clientId));
  const clientName = client
    ? escapeHTML(client.name)
    : '<em style="color:var(--color-text-muted);">[Cliente inactivo/eliminado]</em>';

  const t         = sale.totals || { revenue: 0, cost: 0, profit: 0, margin: 0 };
  const marginPct = t.revenue > 0 ? ((t.profit / t.revenue) * 100).toFixed(1) + '%' : '—';
  const profitCls = t.profit >= 0 ? 'inv-qty-positive' : 'inv-qty-negative';

  const attCount  = (sale.attachments || []).length;
  const attBadge  = attCount > 0
    ? `<span class="badge badge--blue" style="cursor:pointer;"
         data-action="view-attach" data-id="${sale.id}">📎 ${attCount}</span>`
    : '<span style="color:var(--color-text-muted);">—</span>';

  const invBadge = sale.investor
    ? `<span class="badge badge--investor"
         title="Precio inv. — beneficio: ${formatCurrency(sale.investor.benefitDiscountTotal)}, amort.: ${formatCurrency(sale.investor.amortizationTotal)}">◇ INV</span> `
    : '';

  // AR status
  const { status, paid, balance } = getArStatus(sale.id, t.revenue);
  const arLabel = AR_STATUS_LABEL[status];
  const arClass = AR_STATUS_CLASS[status];
  const arTitle = status === 'paid'
    ? `Cobrado: ${formatCurrency(paid)}`
    : `Cobrado: ${formatCurrency(paid)} · Pendiente: ${formatCurrency(balance)}`;

  return `
    <tr class="table-row">
      <td>${escapeHTML(formatDate(sale.saleDate))}</td>
      <td>${invBadge}${clientName}</td>
      <td>${escapeHTML(sale.invoiceNumber || '—')}</td>
      <td class="text-right">${formatCurrency(t.revenue)}</td>
      <td class="text-right">${formatCurrency(t.cost)}</td>
      <td class="text-right"><span class="${profitCls}">${formatCurrency(t.profit)}</span></td>
      <td class="text-right">${marginPct}</td>
      <td class="text-center">
        <button class="badge ${arClass} ar-status-btn"
          data-action="payments" data-id="${sale.id}"
          title="${escapeHTML(arTitle)}"
          style="cursor:pointer;border:none;font-size:0.75rem;padding:2px 8px;">
          ${escapeHTML(arLabel)}
        </button>
      </td>
      <td class="text-center">${attBadge}</td>
      <td class="text-center td-actions">
        <button class="btn btn--ghost btn--xs" data-action="edit"   data-id="${sale.id}">✎ Editar</button>
        <button class="btn btn--danger btn--xs" data-action="delete" data-id="${sale.id}">✕ Eliminar</button>
      </td>
    </tr>
  `;
}

// ─── Listeners ────────────────────────────────────────────────────────────────

function attachListeners() {
  document.getElementById('sales-form').addEventListener('submit', handleFormSubmit);
  document.getElementById('sales-cancel-btn').addEventListener('click', resetForm);
  document.getElementById('sales-add-line-btn').addEventListener('click', () => addLineRow());

  document.getElementById('sales-filter-month').addEventListener('change', applyFilters);
  document.getElementById('sales-filter-client').addEventListener('change', applyFilters);
  document.getElementById('sales-filter-ar').addEventListener('change', applyFilters);
  document.getElementById('sales-search').addEventListener('input', applyFilters);

  document.getElementById('sale-file-input')
    .addEventListener('change', e => handleFileInput(e.target.files));

  document.getElementById('sale-field-date')
    .addEventListener('change', updateTotalsPreview);

  // Client change → refresh investor banner + totals
  document.getElementById('sale-field-client').addEventListener('change', () => {
    refreshInvestorBanner();
    updateTotalsPreview();
    document.querySelectorAll('#sales-lines-tbody .sale-line-row')
      .forEach(row => updateLinePreview(row));
  });

  document.getElementById('sales-table-card').addEventListener('click', e => {
    const attBtn = e.target.closest('[data-action="view-attach"]');
    if (attBtn) {
      const sale = allSales.find(s => String(s.id) === String(attBtn.dataset.id));
      if (sale) viewAttachments(sale.attachments || []);
    }
  });
}

// ─── Investor Helpers ─────────────────────────────────────────────────────────

function isInvestorSale(clientId) {
  return !!(investorRecord && String(investorRecord.clientId) === String(clientId));
}

function effectiveInvestorDebt() {
  return investorRecord ? (investorRecord.totalDebt || 0) : 0;
}

function refreshInvestorBanner() {
  const clientId = document.getElementById('sale-field-client')?.value || '';
  const banner   = document.getElementById('sales-investor-banner');
  const hint     = document.getElementById('sales-investor-debt-hint');
  if (!banner) return;

  const show = isInvestorSale(clientId);
  banner.style.display = show ? '' : 'none';
  if (show && hint) {
    const debt = effectiveInvestorDebt();
    hint.textContent = debt > 0
      ? `Deuda actual: ${formatCurrency(debt)}`
      : 'Deuda saldada — solo aplica descuento beneficio.';
  }
}

/**
 * Compute investor adjustments for a set of enriched lines.
 * Returns adjusted lines and totals.
 */
function computeInvestorAdjustments(enrichedLines, currentDebt) {
  let remainingDebt        = currentDebt;
  let benefitDiscountTotal = 0;
  let amortizationTotal    = 0;

  const adjustedLines = enrichedLines.map(line => {
    if (line.productType !== 'manufactured') return line;

    const benefitDiscount  = INVESTOR_BENEFIT_PER_PKG * line.quantity;
    const paydownDiscount  = Math.min(INVESTOR_PAYDOWN_PER_PKG * line.quantity, remainingDebt);
    remainingDebt         -= paydownDiscount;
    benefitDiscountTotal  += benefitDiscount;
    amortizationTotal     += paydownDiscount;

    const totalDiscount  = benefitDiscount + paydownDiscount;
    const adjRevenue     = Math.max(0, line.lineRevenue - totalDiscount);
    return {
      ...line,
      lineRevenue: adjRevenue,
      lineProfit:  adjRevenue - line.lineCost,
    };
  });

  return { adjustedLines, benefitDiscountTotal, amortizationTotal };
}

// ─── Accounts Receivable Modal ────────────────────────────────────────────────

/**
 * Open the AR payments modal for a given sale.
 * Modal is injected into body so it survives container re-renders.
 * @param {string} saleId
 */
async function openPaymentsModal(saleId) {
  const sale   = allSales.find(s => String(s.id) === String(saleId));
  if (!sale) return;

  const client   = allClientsIndex.get(String(sale.clientId));
  const clientName = client ? client.name : '[Cliente eliminado]';
  const revenue    = (sale.totals || {}).revenue || 0;

  // Remove any stale modal
  document.getElementById('ar-modal-backdrop')?.remove();

  const MODAL_ID = 'ar-modal-backdrop';
  const backdrop = document.createElement('div');
  backdrop.id        = MODAL_ID;
  backdrop.className = 'ar-modal-backdrop';
  backdrop.innerHTML = buildArModalHTML(sale, clientName, revenue);
  document.body.appendChild(backdrop);

  // Render payments list
  _renderArPaymentsList(saleId, revenue);

  // ── Event bindings ────────────────────────────────────────────────────────

  // Close on backdrop click
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) _closeArModal();
  });
  backdrop.querySelector('#ar-modal-close').addEventListener('click', _closeArModal);

  // Keyboard ESC
  const onKey = e => { if (e.key === 'Escape') { _closeArModal(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  // Add payment form submit
  backdrop.querySelector('#ar-payment-form').addEventListener('submit', async e => {
    e.preventDefault();
    await _handleAddPayment(saleId, revenue);
  });
}

function buildArModalHTML(sale, clientName, revenue) {
  const methodOptions = PAYMENT_METHODS.map(m =>
    `<option value="${m.value}">${escapeHTML(m.label)}</option>`
  ).join('');

  const invNote = sale.invoiceNumber
    ? `<span style="color:var(--color-text-muted);font-size:0.82rem;">Factura: ${escapeHTML(sale.invoiceNumber)}</span>`
    : '';

  return `
    <div class="ar-modal" role="dialog" aria-modal="true" aria-labelledby="ar-modal-title">

      <!-- Header -->
      <div class="ar-modal__header">
        <div>
          <h3 class="ar-modal__title" id="ar-modal-title">
            <span style="color:var(--color-accent,#6c63ff);">◈</span>
            Cuentas por Cobrar
          </h3>
          <div style="margin-top:4px;display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap;">
            <span style="font-size:0.9rem;color:var(--color-text-muted);">
              ${escapeHTML(clientName)} · ${escapeHTML(formatDate(sale.saleDate))}
            </span>
            ${invNote}
          </div>
        </div>
        <button class="ar-modal__close" id="ar-modal-close" type="button"
          aria-label="Cerrar">✕</button>
      </div>

      <!-- Summary bar -->
      <div class="ar-summary-bar" id="ar-summary-bar">
        <!-- populated by _renderArPaymentsList -->
      </div>

      <!-- Payments list -->
      <div class="ar-payments-section">
        <div class="ar-section-title">Pagos registrados</div>
        <div id="ar-payments-list">
          <div style="display:flex;align-items:center;gap:8px;padding:var(--space-md);color:var(--color-text-muted);">
            <div class="spinner spinner--sm"></div> Cargando…
          </div>
        </div>
      </div>

      <!-- Add payment form -->
      <div class="ar-add-section">
        <div class="ar-section-title">Registrar pago</div>
        <form id="ar-payment-form" novalidate>
          <div class="ar-form-grid">
            <div class="form-group" style="margin:0;">
              <label class="form-label" for="ar-field-date">Fecha <span class="required">*</span></label>
              <input class="form-input form-input--sm" type="date"
                id="ar-field-date" value="${todayString()}" required>
              <span class="form-error" id="ar-error-date"></span>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label" for="ar-field-amount">Monto (RD$) <span class="required">*</span></label>
              <input class="form-input form-input--sm" type="number"
                id="ar-field-amount" min="0.01" step="0.01" placeholder="0.00" required>
              <span class="form-error" id="ar-error-amount"></span>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label" for="ar-field-method">Método</label>
              <div class="select-wrapper">
                <select class="form-input form-select form-input--sm" id="ar-field-method">
                  ${methodOptions}
                </select>
              </div>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label" for="ar-field-notes">Notas (opcional)</label>
              <input class="form-input form-input--sm" type="text"
                id="ar-field-notes" maxlength="150" placeholder="Referencia, cheque #…">
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:var(--space-md);">
            <button type="submit" class="btn btn--primary btn--sm" id="ar-submit-btn">
              ＋ Registrar pago
            </button>
          </div>
        </form>
      </div>

    </div>
  `;
}

/**
 * Render (or re-render) the summary bar and payments list inside the open modal.
 * Also refreshes the payments map so the table badge updates on close.
 * @param {string} saleId
 * @param {number} revenue
 */
function _renderArPaymentsList(saleId, revenue) {
  const payments = _paymentsMap.get(String(saleId)) || [];
  const { status, paid, balance } = getArStatus(saleId, revenue);

  // ── Summary bar ──────────────────────────────────────────────────────────
  const summaryBar = document.getElementById('ar-summary-bar');
  if (summaryBar) {
    const pct     = revenue > 0 ? Math.min(100, (paid / revenue) * 100) : 0;
    const barClass = status === 'paid' ? 'ar-progress--paid'
                   : status === 'partial' ? 'ar-progress--partial'
                   : 'ar-progress--unpaid';
    summaryBar.innerHTML = `
      <div class="ar-summary-row">
        <div class="ar-summary-kpi">
          <span class="ar-summary-kpi__label">Total factura</span>
          <span class="ar-summary-kpi__value">${formatCurrency(revenue)}</span>
        </div>
        <div class="ar-summary-kpi">
          <span class="ar-summary-kpi__label">Cobrado</span>
          <span class="ar-summary-kpi__value ar-summary-kpi__value--paid">${formatCurrency(paid)}</span>
        </div>
        <div class="ar-summary-kpi">
          <span class="ar-summary-kpi__label">Pendiente</span>
          <span class="ar-summary-kpi__value ar-summary-kpi__value--balance"
            style="${balance <= 0 ? 'color:var(--color-success);' : ''}">${formatCurrency(balance)}</span>
        </div>
        <div class="ar-summary-kpi">
          <span class="ar-summary-kpi__label">Estado</span>
          <span class="badge ${AR_STATUS_CLASS[status]}" style="font-size:0.8rem;">
            ${AR_STATUS_LABEL[status]}
          </span>
        </div>
      </div>
      <div class="ar-progress-track">
        <div class="ar-progress-bar ${barClass}" style="width:${pct.toFixed(1)}%;"></div>
      </div>
    `;
  }

  // ── Payments list ────────────────────────────────────────────────────────
  const listEl = document.getElementById('ar-payments-list');
  if (!listEl) return;

  if (!payments.length) {
    listEl.innerHTML = `
      <div style="padding:var(--space-md);text-align:center;color:var(--color-text-muted);font-size:0.85rem;">
        Sin pagos registrados aún.
      </div>`;
    return;
  }

  const sorted = [...payments].sort((a, b) =>
    (a.paymentDate || '').localeCompare(b.paymentDate || ''));

  const methodLabel = v => PAYMENT_METHODS.find(m => m.value === v)?.label || v || '—';

  listEl.innerHTML = `
    <table class="data-table ar-payments-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th class="text-right">Monto</th>
          <th>Método</th>
          <th>Notas</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(p => `
          <tr>
            <td>${escapeHTML(formatDate(p.paymentDate))}</td>
            <td class="text-right" style="font-weight:600;color:var(--color-success);">${formatCurrency(p.amount)}</td>
            <td>${escapeHTML(methodLabel(p.method))}</td>
            <td style="color:var(--color-text-muted);font-size:0.82rem;">${escapeHTML(p.notes || '—')}</td>
            <td class="text-center">
              <button class="btn btn--danger btn--xs"
                data-action="del-payment" data-payment-id="${escapeHTML(p.id)}"
                title="Eliminar pago">✕</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Wire delete buttons
  listEl.querySelectorAll('[data-action="del-payment"]').forEach(btn => {
    btn.addEventListener('click', () => _handleDeletePayment(btn.dataset.paymentId, saleId, revenue));
  });
}

/**
 * Handle the add-payment form submission inside the AR modal.
 */
async function _handleAddPayment(saleId, revenue) {
  // Validate
  const dateEl   = document.getElementById('ar-field-date');
  const amountEl = document.getElementById('ar-field-amount');
  const errDate  = document.getElementById('ar-error-date');
  const errAmt   = document.getElementById('ar-error-amount');

  if (errDate)  errDate.textContent  = '';
  if (errAmt)   errAmt.textContent   = '';

  let valid = true;
  if (!dateEl?.value) {
    if (errDate) errDate.textContent = 'La fecha es obligatoria.';
    valid = false;
  }
  const amount = parseFloat(amountEl?.value);
  if (!amount || amount <= 0) {
    if (errAmt) errAmt.textContent = 'Ingresa un monto mayor a 0.';
    valid = false;
  }
  if (!valid) return;

  const submitBtn = document.getElementById('ar-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    const payment = await SalePaymentsAPI.create({
      saleId,
      paymentDate: dateEl.value,
      amount,
      method: document.getElementById('ar-field-method')?.value || 'cash',
      notes:  document.getElementById('ar-field-notes')?.value  || '',
    });

    // Update in-memory map
    const key = String(saleId);
    if (!_paymentsMap.has(key)) _paymentsMap.set(key, []);
    _paymentsMap.get(key).push(payment);

    // Reset amount + notes; keep date and method for quick multi-entry
    if (amountEl) amountEl.value = '';
    const notesEl = document.getElementById('ar-field-notes');
    if (notesEl) notesEl.value = '';

    _renderArPaymentsList(saleId, revenue);

    // Refresh table badge in background (no full reload needed)
    _refreshSaleRowBadge(saleId);

    showFeedback(`Pago de ${formatCurrency(amount)} registrado.`, 'success');
  } catch (err) {
    showFeedback(`Error al registrar pago: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Handle deleting a single payment entry.
 */
function _handleDeletePayment(paymentId, saleId, revenue) {
  _showDeleteConfirm('¿Eliminar este pago? Esta acción no se puede deshacer.', async () => {
    try {
      await SalePaymentsAPI.remove(paymentId);

      // Update in-memory map
      const key = String(saleId);
      const list = _paymentsMap.get(key) || [];
      _paymentsMap.set(key, list.filter(p => String(p.id) !== String(paymentId)));

      _renderArPaymentsList(saleId, revenue);
      _refreshSaleRowBadge(saleId);
      showFeedback('Pago eliminado.', 'success');
    } catch (err) {
      showFeedback(`Error al eliminar pago: ${err.message}`, 'error');
    }
  });
}

/**
 * Refresh only the AR status badge in the sale table row — avoids a full re-render.
 * @param {string} saleId
 */
function _refreshSaleRowBadge(saleId) {
  const sale = allSales.find(s => String(s.id) === String(saleId));
  if (!sale) return;
  const revenue = (sale.totals || {}).revenue || 0;
  const { status, paid, balance } = getArStatus(saleId, revenue);

  const btn = document.querySelector(
    `#sales-tbody [data-action="payments"][data-id="${CSS.escape(String(saleId))}"]`
  );
  if (!btn) return;
  btn.className = `badge ${AR_STATUS_CLASS[status]} ar-status-btn`;
  btn.textContent = AR_STATUS_LABEL[status];
  const title = status === 'paid'
    ? `Cobrado: ${formatCurrency(paid)}`
    : `Cobrado: ${formatCurrency(paid)} · Pendiente: ${formatCurrency(balance)}`;
  btn.title = title;
}

function _closeArModal() {
  document.getElementById('ar-modal-backdrop')?.remove();
}

// ─── Form Submit ──────────────────────────────────────────────────────────────

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const submitBtn = document.getElementById('sales-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    const saleDate     = document.getElementById('sale-field-date').value;
    const clientId     = document.getElementById('sale-field-client').value;
    const invoiceNumber = document.getElementById('sale-field-invoice').value.trim();
    const notes        = document.getElementById('sale-field-notes').value.trim();
    const month        = saleDate.slice(0, 7);
    const investorSale = isInvestorSale(clientId);

    const { costPerPackage: mfgCost, missing: costMissing } =
      computeMonthlyCostPerPackage(month);

    const rawLines = collectLines();

    // Build line objects with typed cost
    const lines = rawLines.map(l => {
      const product  = productMap.get(String(l.productId));
      const pType    = product ? product.type : 'manufactured';
      const resaleCostPerUnit = pType === 'resale' ? l.resaleCost : 0;
      const costPerUnit       = pType === 'resale' ? l.resaleCost : mfgCost;
      return {
        productId:            l.productId,
        productType:          pType,
        quantity:             l.quantity,
        unitPrice:            l.unitPrice,
        salePricePerUnit:     l.unitPrice,
        costPerUnitSnapshot:  costPerUnit,
        resaleCostPerUnit:    resaleCostPerUnit,
        resaleCostPerUnitInput: resaleCostPerUnit,
        lineRevenue:          l.quantity * l.unitPrice,
        lineCost:             l.quantity * costPerUnit,
        lineProfit:           l.quantity * l.unitPrice - l.quantity * costPerUnit,
      };
    });

    // Investor adjustments
    let investorData     = null;
    let amortizationTotal = 0;

    if (investorSale) {
      const enriched = lines.map(l => ({
        ...l,
        lineRevenue: l.lineRevenue,
        lineCost:    l.lineCost,
      }));
      const adj = computeInvestorAdjustments(enriched, effectiveInvestorDebt());
      amortizationTotal = adj.amortizationTotal;
      investorData = {
        benefitDiscountTotal: adj.benefitDiscountTotal,
        amortizationTotal:    adj.amortizationTotal,
      };
    }

    const totals = computeTotals(
      investorSale
        ? computeInvestorAdjustments(lines, effectiveInvestorDebt()).adjustedLines
        : lines
    );

    const payload = {
      saleDate,
      month,
      clientId,
      invoiceNumber: invoiceNumber || null,
      notes:         notes         || null,
      status:        'confirmed',
      totals,
      lines,
      attachments:   currentAttachments,
      investor:      investorData,
    };

    if (editingSale) {
      // ── EDIT PATH ─────────────────────────────────────────────────────────
      const wasInvestor = isInvestorSale(editingSale.clientId);

      // Delta inventory for manufactured lines
      const oldLines    = editingSale.lines || [];
      const oldLineMap  = new Map(
        oldLines.filter(l => l.productType === 'manufactured')
                .map(l => [String(l.productId), l.quantity])
      );
      for (const line of lines) {
        if (line.productType !== 'manufactured') continue;
        const product  = productMap.get(String(line.productId));
        if (!product) continue;
        const invItemId = await ensureProductInventoryItem(product);
        const oldQty    = oldLineMap.get(String(line.productId)) || 0;
        const delta     = line.quantity - oldQty;
        if (delta > 0)      await InventoryAPI.removeStock(invItemId, delta,  editingSale.id, 'Edición de venta');
        else if (delta < 0) await InventoryAPI.addStock(invItemId,  -delta, editingSale.id, 'Edición de venta (devolución parcial)');
      }
      // Return stock for lines removed entirely
      for (const [pId, oldQty] of oldLineMap) {
        const stillPresent = lines.find(l => String(l.productId) === pId && l.productType === 'manufactured');
        if (!stillPresent) {
          const product = productMap.get(pId);
          if (!product) continue;
          const invItemId = await ensureProductInventoryItem(product);
          await InventoryAPI.addStock(invItemId, oldQty, editingSale.id, 'Edición de venta (línea eliminada)');
        }
      }

      await SalesAPI.update(editingSale.id, payload);

      if (investorSale && amortizationTotal > 0) {
        await InvestorAPI.setSaleAmortization(
          editingSale.id,
          amortizationTotal,
          `Amortización automática${invoiceNumber ? ' — ' + invoiceNumber : ''}`
        );
      } else if (wasInvestor) {
        await InvestorAPI.clearSaleAmortization(
          editingSale.id,
          'Cliente cambiado; amortización revertida'
        );
      }

      showFeedback('Venta actualizada correctamente.', 'success');

    } else {
      // ── CREATE PATH ───────────────────────────────────────────────────────
      const stockError = await validateManufacturedStock(lines);
      if (stockError) {
        showFeedback(stockError, 'error', 8000);
        setButtonLoading(submitBtn, false);
        return;
      }

      const newSale = await SalesAPI.create(payload);

      for (const line of lines) {
        if (line.productType !== 'manufactured') continue;
        const product = productMap.get(String(line.productId));
        if (!product) continue;
        const invItemId = await ensureProductInventoryItem(product);
        await InventoryAPI.removeStock(invItemId, line.quantity, newSale.id, 'Venta');
      }

      if (investorSale && amortizationTotal > 0) {
        await InvestorAPI.setSaleAmortization(
          newSale.id,
          amortizationTotal,
          `Amortización automática${invoiceNumber ? ' — ' + invoiceNumber : ' — ' + newSale.id}`
        );
      }
    }

    if (costMissing) {
      showFeedback(
        'Costo manufactura del mes no disponible; costo registrado como 0. ' +
        'Revisa Materia Prima / Inventario mensual.',
        'info', 7000
      );
    }

    resetForm();
    await loadAll();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

function handleEdit(saleId) {
  const sale = allSales.find(s => String(s.id) === String(saleId));
  if (!sale) return;

  editingSale        = sale;
  currentAttachments = (sale.attachments || []).map(a => ({ ...a }));

  document.getElementById('sale-field-id').value      = sale.id;
  document.getElementById('sale-field-date').value    = sale.saleDate || '';
  document.getElementById('sale-field-client').value  = sale.clientId || '';
  document.getElementById('sale-field-invoice').value = sale.invoiceNumber || '';
  document.getElementById('sale-field-notes').value   = sale.notes || '';

  document.getElementById('sales-lines-tbody').innerHTML = '';
  _lineSeq = 0;
  (sale.lines || []).forEach(line => {
    const product  = productMap.get(String(line.productId));
    const isResale = line.productType === 'resale' ||
                     (product && product.type === 'resale');
    addLineRow({
      productId:  line.productId,
      quantity:   line.quantity,
      unitPrice:  line.unitPrice,
      resaleCost: isResale
        ? (line.resaleCostPerUnitInput ?? line.costPerUnitSnapshot)
        : '',
    });
  });

  renderAttachmentList();
  refreshInvestorBanner();
  updateTotalsPreview();

  document.getElementById('sales-form-title').innerHTML =
    '<span class="card__title-icon">✎</span> Editar Venta';
  document.getElementById('sales-submit-btn').innerHTML =
    '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('sales-cancel-btn').style.display = 'inline-flex';
  document.getElementById('sales-form-card').scrollIntoView({ behavior: 'smooth' });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function _showDeleteConfirm(message, onConfirm) {
  document.getElementById('delete-confirm-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id        = 'delete-confirm-backdrop';
  backdrop.className = 'ar-modal-backdrop';
  backdrop.innerHTML = `
    <div class="ar-modal" role="dialog" aria-modal="true" style="max-width:420px;">
      <div class="ar-modal__header">
        <h3 class="ar-modal__title" style="color:var(--color-danger);">⚠ Confirmar eliminación</h3>
        <button class="ar-modal__close" id="del-confirm-close" type="button" aria-label="Cerrar">✕</button>
      </div>
      <p style="padding:var(--space-md) var(--space-lg);white-space:pre-wrap;color:var(--color-text);">${escapeHTML(message)}</p>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-sm);padding:var(--space-md) var(--space-lg);">
        <button class="btn btn--ghost btn--sm" id="del-confirm-cancel">Cancelar</button>
        <button class="btn btn--danger btn--sm" id="del-confirm-ok">✕ Eliminar</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  backdrop.querySelector('#del-confirm-cancel').addEventListener('click', close);
  backdrop.querySelector('#del-confirm-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  const onKey = e => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  backdrop.querySelector('#del-confirm-ok').addEventListener('click', () => {
    close();
    document.removeEventListener('keydown', onKey);
    onConfirm();
  });
}

function handleDelete(saleId) {
  const sale = allSales.find(s => String(s.id) === String(saleId));
  if (!sale) return;

  const client    = allClientsIndex.get(String(sale.clientId));
  const clientLbl = client ? client.name : '[Cliente eliminado]';
  const amortNote = sale.investor?.amortizationTotal > 0
    ? `\n\nSe revertirán ${formatCurrency(sale.investor?.amortizationTotal)} de amortización de deuda.`
    : '';
  const paymentsForSale = _paymentsMap.get(String(saleId)) || [];
  const payNote = paymentsForSale.length > 0
    ? `\n\nSe eliminarán ${paymentsForSale.length} pago(s) registrado(s).`
    : '';

  const confirmMsg =
    `¿Eliminar la venta del ${formatDate(sale.saleDate)} para ${clientLbl}?\n\n` +
    `Esto devolverá el stock de productos manufacturados al inventario.${amortNote}${payNote}`;

  _showDeleteConfirm(confirmMsg, async () => {
    try {
      // Return manufactured stock
      for (const line of (sale.lines || [])) {
        if (line.productType !== 'manufactured') continue;
        const product = productMap.get(String(line.productId));
        if (!product) continue;
        const invItemId = await ensureProductInventoryItem(product);
        await InventoryAPI.addStock(invItemId, line.quantity, saleId,
          'Reverso por eliminación de venta');
      }

      // Reverse investor amortization
      const hadAmort = (sale.investor?.amortizationTotal || 0) > 0;
      const wasInv   = isInvestorSale(sale.clientId);
      if (hadAmort || wasInv) {
        await InvestorAPI.clearSaleAmortization(saleId, 'Reversión por eliminación de venta');
      }

      // Remove payments for this sale
      await SalePaymentsAPI.removeBySaleId(saleId);

      await SalesAPI.remove(saleId);
      showFeedback('Venta eliminada y stock restaurado.', 'success');
      await loadAll();
    } catch (err) {
      showFeedback(`Error al eliminar: ${err.message}`, 'error');
    }
  });
}

// ─── Reset Form ───────────────────────────────────────────────────────────────

function resetForm() {
  editingSale        = null;
  currentAttachments = [];

  document.getElementById('sales-form').reset();
  document.getElementById('sale-field-id').value   = '';
  document.getElementById('sale-field-date').value = todayString();
  document.getElementById('sales-lines-tbody').innerHTML = '';
  _lineSeq = 0;

  renderAttachmentList();
  refreshInvestorBanner();
  updateTotalsPreview();
  clearFormErrors();

  document.getElementById('sales-form-title').innerHTML =
    '<span class="card__title-icon">+</span> Nueva Venta';
  document.getElementById('sales-submit-btn').innerHTML =
    '<span class="btn__icon">＋</span> Guardar Venta';
  document.getElementById('sales-cancel-btn').style.display = 'none';
  document.getElementById('sale-file-input').value = '';

  _prefillInvoiceNumber();
}

async function _prefillInvoiceNumber() {
  const field = document.getElementById('sale-field-invoice');
  if (!field || field.value) return;
  try {
    field.value = await nextInvoiceNumber('FAC-');
  } catch (_) {
    // Leave empty so admin can type the number manually
  }
}

// ─── Line Management ──────────────────────────────────────────────────────────

function addLineRow(data = {}) {
  const lineId = ++_lineSeq;
  const tbody  = document.getElementById('sales-lines-tbody');
  const tr     = document.createElement('tr');
  tr.classList.add('sale-line-row');
  tr.dataset.lineId = lineId;
  tr.innerHTML = buildLineRowHTML(data);
  tbody.appendChild(tr);

  const row = tbody.querySelector(`tr[data-line-id="${lineId}"]`);

  row.querySelector('.sl-product').addEventListener('change', () => {
    toggleResaleCostInput(row);
    updateLinePreview(row);
    updateTotalsPreview();
  });
  ['sl-qty', 'sl-price', 'sl-resale-cost'].forEach(cls => {
    row.querySelector('.' + cls).addEventListener('input', () => {
      updateLinePreview(row);
      updateTotalsPreview();
    });
  });
  row.querySelector('.sl-remove-btn').addEventListener('click', () => {
    row.remove();
    updateTotalsPreview();
  });

  if (data.productId) {
    row.querySelector('.sl-product').value = data.productId;
    toggleResaleCostInput(row);
    updateLinePreview(row);
  }
}

function buildLineRowHTML(data = {}) {
  const products = [...productMap.values()];
  const productOptions = products.map(p => {
    const sel  = String(p.id) === String(data.productId || '') ? 'selected' : '';
    const icon = p.type === 'manufactured' ? '⬡' : '◈';
    return `<option value="${escapeHTML(String(p.id))}" ${sel}>${icon} ${escapeHTML(p.name)}</option>`;
  }).join('');

  const product     = data.productId ? productMap.get(String(data.productId)) : null;
  const isResale    = product ? product.type === 'resale' : false;
  const resaleStyle = isResale ? '' : 'display:none;';
  const mfgStyle    = isResale ? 'display:none;' : '';

  return `
    <td>
      <div class="select-wrapper" style="min-width:160px;">
        <select class="form-input form-select form-input--sm sl-product" required>
          <option value="" disabled ${!data.productId ? 'selected' : ''}>Producto…</option>
          ${productOptions}
        </select>
      </div>
    </td>
    <td>
      <input class="form-input form-input--sm text-right sl-qty"
        type="number" min="1" step="1" placeholder="0"
        value="${escapeHTML(String(data.quantity || ''))}" style="width:80px;">
    </td>
    <td>
      <input class="form-input form-input--sm text-right sl-price"
        type="number" min="0" step="0.01" placeholder="0.00"
        value="${escapeHTML(String(data.unitPrice || ''))}" style="width:100px;">
    </td>
    <td>
      <input class="form-input form-input--sm text-right sl-resale-cost"
        type="number" min="0" step="0.01" placeholder="0.00"
        value="${escapeHTML(String(data.resaleCost || ''))}"
        style="width:100px;${resaleStyle}">
      <span class="sl-mfg-cost-note" style="${mfgStyle}color:var(--color-text-muted);font-size:0.75rem;">
        (mensual)
      </span>
    </td>
    <td class="text-right sl-preview-revenue" style="font-size:0.85rem;">—</td>
    <td class="text-right sl-preview-cost"    style="font-size:0.85rem;">—</td>
    <td class="text-right sl-preview-profit"  style="font-size:0.85rem;">—</td>
    <td>
      <button type="button" class="btn btn--danger btn--xs sl-remove-btn"
        title="Quitar línea">✕</button>
    </td>
  `;
}

function toggleResaleCostInput(rowEl) {
  const productId = rowEl.querySelector('.sl-product').value;
  const product   = productMap.get(String(productId));
  const isResale  = product ? product.type === 'resale' : false;
  rowEl.querySelector('.sl-resale-cost').style.display   = isResale ? '' : 'none';
  rowEl.querySelector('.sl-mfg-cost-note').style.display = isResale ? 'none' : '';
}

function updateLinePreview(rowEl) {
  const productId = rowEl.querySelector('.sl-product').value;
  const qty       = parseFloat(rowEl.querySelector('.sl-qty').value)   || 0;
  const price     = parseFloat(rowEl.querySelector('.sl-price').value)  || 0;
  const product   = productMap.get(String(productId));
  const isResale  = product ? product.type === 'resale' : false;
  const clientId  = document.getElementById('sale-field-client')?.value || '';
  const invSale   = isInvestorSale(clientId);

  const lineRevenue = qty * price;
  let lineCost = 0;
  if (isResale) {
    lineCost = qty * (parseFloat(rowEl.querySelector('.sl-resale-cost').value) || 0);
  } else {
    const saleDate = document.getElementById('sale-field-date').value || todayString();
    const { costPerPackage } = computeMonthlyCostPerPackage(saleDate.slice(0, 7));
    lineCost = qty * costPerPackage;
  }

  const invDiscount = (invSale && !isResale)
    ? (INVESTOR_BENEFIT_PER_PKG + INVESTOR_PAYDOWN_PER_PKG) * qty
    : 0;

  const netRevenue = lineRevenue - invDiscount;
  const lineProfit = netRevenue - lineCost;

  rowEl.querySelector('.sl-preview-revenue').textContent = formatCurrency(netRevenue);
  rowEl.querySelector('.sl-preview-cost').textContent    = formatCurrency(lineCost);
  const profitEl = rowEl.querySelector('.sl-preview-profit');
  profitEl.textContent = formatCurrency(lineProfit);
  profitEl.style.color = lineProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
}

function collectLines() {
  return [...document.querySelectorAll('#sales-lines-tbody .sale-line-row')]
    .map(row => ({
      productId:  row.querySelector('.sl-product').value,
      quantity:   parseFloat(row.querySelector('.sl-qty').value)        || 0,
      unitPrice:  parseFloat(row.querySelector('.sl-price').value)       || 0,
      resaleCost: parseFloat(row.querySelector('.sl-resale-cost').value) || 0,
    }))
    .filter(l => l.productId && l.quantity > 0);
}

function updateTotalsPreview() {
  const saleDate = document.getElementById('sale-field-date').value || todayString();
  const month    = saleDate.slice(0, 7);
  const { costPerPackage: mfgCost } = computeMonthlyCostPerPackage(month);
  const clientId = document.getElementById('sale-field-client')?.value || '';
  const invSale  = isInvestorSale(clientId);

  const rawLines = collectLines();

  const enriched = rawLines.map(l => {
    const product  = productMap.get(String(l.productId));
    const pType    = product ? product.type : 'manufactured';
    const lineCost = pType === 'resale' ? l.quantity * l.resaleCost : l.quantity * mfgCost;
    const lineRev  = l.quantity * l.unitPrice;
    return { productType: pType, quantity: l.quantity, lineRevenue: lineRev,
             lineCost, lineProfit: lineRev - lineCost };
  });

  let revenue = 0, cost = 0;
  let benefitDiscountTotal = 0, amortizationTotal = 0;

  if (invSale && enriched.length) {
    const adj = computeInvestorAdjustments(enriched, effectiveInvestorDebt());
    revenue              = adj.adjustedLines.reduce((s, l) => s + l.lineRevenue, 0);
    cost                 = adj.adjustedLines.reduce((s, l) => s + l.lineCost,    0);
    benefitDiscountTotal = adj.benefitDiscountTotal;
    amortizationTotal    = adj.amortizationTotal;
  } else {
    enriched.forEach(l => { revenue += l.lineRevenue; cost += l.lineCost; });
  }

  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  document.getElementById('preview-revenue').textContent = formatCurrency(revenue);
  document.getElementById('preview-cost').textContent    = formatCurrency(cost);
  const profitEl = document.getElementById('preview-profit');
  profitEl.textContent = formatCurrency(profit);
  profitEl.style.color = profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  document.getElementById('preview-margin').textContent =
    revenue > 0 ? margin.toFixed(1) + '%' : '—';

  const benefitWrap = document.getElementById('inv-preview-benefit-wrap');
  const paydownWrap = document.getElementById('inv-preview-paydown-wrap');
  const showInv     = invSale && (benefitDiscountTotal > 0 || amortizationTotal > 0);
  if (benefitWrap && paydownWrap) {
    benefitWrap.style.display = showInv ? '' : 'none';
    paydownWrap.style.display = showInv ? '' : 'none';
    if (showInv) {
      document.getElementById('inv-preview-benefit').textContent =
        '−' + formatCurrency(benefitDiscountTotal);
      document.getElementById('inv-preview-paydown').textContent =
        '−' + formatCurrency(amortizationTotal);
    }
  }
}

// ─── Attachment Management ────────────────────────────────────────────────────

const MAX_ATTACH    = 3;
const MAX_ATTACH_MB = 1.5;

function handleFileInput(files) {
  for (const file of files) {
    if (currentAttachments.length >= MAX_ATTACH) {
      showFeedback(`Máximo ${MAX_ATTACH} archivos por venta.`, 'warning');
      break;
    }
    if (file.size > MAX_ATTACH_MB * 1024 * 1024) {
      showFeedback(
        `"${file.name}" supera ${MAX_ATTACH_MB} MB. ` +
        'Los archivos se almacenan en localStorage y deben ser pequeños.',
        'warning', 6000
      );
      continue;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      currentAttachments.push({
        id:      crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        name:    file.name,
        size:    file.size,
        type:    file.type,
        dataUrl: ev.target.result,
      });
      renderAttachmentList();
    };
    reader.readAsDataURL(file);
  }
  document.getElementById('sale-file-input').value = '';
}

function renderAttachmentList() {
  const container = document.getElementById('sales-attach-list');
  if (!container) return;
  if (!currentAttachments.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = currentAttachments.map(att => `
    <div class="sales-attach-chip">
      <span class="sales-attach-icon">${att.type === 'application/pdf' ? '📄' : '🖼'}</span>
      <span class="sales-attach-name" title="${escapeHTML(att.name)}">${escapeHTML(att.name)}</span>
      <span class="sales-attach-size">${formatFileSize(att.size)}</span>
      <a href="${att.dataUrl}" target="_blank" rel="noopener"
         class="btn btn--ghost btn--xs">Ver</a>
      <button type="button" class="btn btn--danger btn--xs sales-attach-remove"
        data-att-id="${escapeHTML(att.id)}">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.sales-attach-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      currentAttachments = currentAttachments.filter(a => a.id !== btn.dataset.attId);
      renderAttachmentList();
    });
  });
}

function viewAttachments(attachments) {
  if (!attachments.length) return;
  if (attachments.length === 1) {
    window.open(attachments[0].dataUrl, '_blank', 'noopener');
    return;
  }
  const win = window.open('', '_blank', 'width=400,height=300,noopener');
  if (!win) return;
  const links = attachments.map(a =>
    `<li style="margin:8px 0;"><a href="${a.dataUrl}" target="_blank"
       style="font-family:sans-serif;color:#0057b8;">${escapeHTML(a.name)}</a></li>`
  ).join('');
  win.document.write(
    `<html><body style="padding:20px;background:#f8f8f8;">` +
    `<ul style="list-style:none;padding:0;">${links}</ul></body></html>`
  );
  win.document.close();
}

// ─── Inventory Integration ────────────────────────────────────────────────────

async function validateManufacturedStock(lines) {
  const insufficient = [];
  for (const line of lines) {
    if (line.productType !== 'manufactured') continue;
    const product = productMap.get(String(line.productId));
    if (!product) continue;
    const invItemId = await ensureProductInventoryItem(product);
    const item      = await InventoryAPI.getById(invItemId);
    if (!item) continue;
    if (item.stock < line.quantity) {
      insufficient.push(
        `${escapeHTML(product.name)}: necesario ${line.quantity} ${item.unit}, ` +
        `disponible ${item.stock} ${item.unit}.`
      );
    }
  }
  return insufficient.length
    ? `Stock insuficiente:\n${insufficient.join('\n')}`
    : null;
}

// ─── Monthly Cost Calculation ─────────────────────────────────────────────────

function computeMonthlyCostPerPackage(month) {
  const monthRecords = _allProduction.filter(r => (r.month || r.productionDate?.slice(0,7)) === month);
  const totalPkgs    = monthRecords.reduce((s, r) => s + (r.quantity || 0), 0);

  if (totalPkgs === 0) return { costPerPackage: 0, missing: true };

  const laborCost = monthRecords.reduce((s, r) =>
    s + (r.operatorRateSnapshot || 0) * (r.quantity || 0), 0);

  const prevMonth = _prevMonthString(month);
  const prevInv   = _allMonthlyInv.find(i => i.month === prevMonth);
  const currInv   = _allMonthlyInv.find(i => i.month === month);

  const materialCost = ['recycled', 'pellet'].reduce((acc, type) => {
    const pLbs  = _allPurchases
      .filter(p => p.month === month && p.materialType === type)
      .reduce((s, p) => s + (p.washedWeightLbs || p.weightLbs || 0), 0);
    const pCost = _allPurchases
      .filter(p => p.month === month && p.materialType === type)
      .reduce((s, p) => s + (p.totalCost || 0) + (p.washingCost || 0), 0);
    const avgCost = pLbs > 0 ? pCost / pLbs : 0;
    const key     = type === 'recycled' ? 'recycledClosingLbs' : 'pelletClosingLbs';
    const openLbs = prevInv ? (prevInv[key] || 0) : 0;
    const closeLbs = currInv ? (currInv[key] || 0) : 0;
    return acc + (openLbs + pLbs - closeLbs) * avgCost;
  }, 0);

  const totalCost      = laborCost + materialCost;
  const costPerPackage = totalPkgs > 0 ? totalCost / totalPkgs : 0;
  return { costPerPackage, missing: costPerPackage === 0 };
}

function _prevMonthString(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// ─── Form Validation ──────────────────────────────────────────────────────────

function validateForm() {
  clearFormErrors();
  let valid = true;

  if (!document.getElementById('sale-field-date').value) {
    showFieldError('sale-error-date', 'La fecha es obligatoria.');
    valid = false;
  }
  if (!document.getElementById('sale-field-client').value) {
    showFieldError('sale-error-client', 'Selecciona un cliente.');
    valid = false;
  }

  const lines = collectLines();
  if (!lines.length) {
    showFieldError('sale-error-lines', 'Agrega al menos un artículo.');
    valid = false;
  }

  const resaleNoCost = lines.filter(l => {
    const p = productMap.get(String(l.productId));
    return p && p.type === 'resale' && (l.resaleCost == null || l.resaleCost < 0);
  });
  if (resaleNoCost.length) {
    showFieldError('sale-error-lines', 'Las líneas de reventa requieren un costo por unidad ≥ 0.');
    valid = false;
  }

  return valid;
}

function clearFormErrors() {
  document.querySelectorAll('#sales-form .form-error').forEach(el => (el.textContent = ''));
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeTotals(lines) {
  const revenue = lines.reduce((s, l) => s + l.lineRevenue, 0);
  const cost    = lines.reduce((s, l) => s + l.lineCost,    0);
  const profit  = revenue - cost;
  return { revenue, cost, profit, margin: revenue > 0 ? profit / revenue : 0 };
}

function populateSelect(selectId, items, mapFn, placeholder) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const current = el.value;
  el.innerHTML = `<option value="" disabled>${escapeHTML(placeholder)}</option>`;
  items.forEach(item => {
    const { value, label } = mapFn(item);
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    el.appendChild(opt);
  });
  if (current) el.value = current;
}

function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('sales-count-badge');
  if (!badge) return;
  badge.textContent = filtered !== null
    ? `${filtered} de ${total} venta${total !== 1 ? 's' : ''}`
    : `${total} venta${total !== 1 ? 's' : ''}`;
}

function showTableLoading(loading) {
  document.getElementById('sales-table-loading').style.display = loading ? 'flex' : 'none';
  document.getElementById('sales-table-wrapper').style.display = loading ? 'none' : '';
  document.getElementById('sales-table-empty').style.display   = 'none';
}

function todayString() { return new Date().toISOString().slice(0, 10); }

function formatDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function formatCurrency(n) {
  return 'RD$ ' + new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  return bytes < 1048576
    ? (bytes / 1024).toFixed(1) + ' KB'
    : (bytes / 1048576).toFixed(2) + ' MB';
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

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ─── Scoped Styles ────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('sales-module-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'sales-module-styles';
  tag.textContent = `
    /* ── Form ── */
    .sales-lines-section {
      border-top: 1px solid var(--color-border);
      margin-top: var(--space-lg); padding-top: var(--space-lg);
    }
    .sales-lines-header {
      display: flex; align-items: center;
      justify-content: space-between; margin-bottom: var(--space-sm);
    }
    .sales-lines-table-wrap { overflow-x: auto; }
    .sales-lines-table td, .sales-lines-table th {
      padding: var(--space-xs) var(--space-sm); vertical-align: middle;
    }
    .sales-totals-preview {
      display: flex; gap: var(--space-lg); flex-wrap: wrap;
      margin-top: var(--space-lg); padding: var(--space-md) var(--space-lg);
      background: var(--color-surface-secondary, var(--color-surface));
      border: 1px solid var(--color-border); border-radius: var(--radius-md);
    }
    .sales-total-item { display: flex; flex-direction: column; gap: 2px; min-width: 120px; }
    .sales-total-label {
      font-size: 0.75rem; color: var(--color-text-muted);
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .sales-total-value { font-size: 1rem; font-weight: 600; color: var(--color-text); }
    .sales-total-item--investor {
      border-left: 2px solid var(--color-primary, #6c63ff);
      padding-left: var(--space-sm);
    }
    .sales-total-investor { color: var(--color-primary, #6c63ff) !important; }

    /* ── Investor banner ── */
    .sales-investor-banner {
      display: flex; align-items: flex-start; gap: var(--space-sm);
      margin-top: var(--space-md); padding: var(--space-sm) var(--space-md);
      background: color-mix(in srgb, var(--color-primary, #6c63ff) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-primary, #6c63ff) 35%, transparent);
      border-radius: var(--radius-sm); font-size: 0.875rem; color: var(--color-text);
    }
    .sales-investor-banner__icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }
    .sales-investor-banner__body { line-height: 1.5; }
    .sales-investor-debt-hint {
      display: inline-block; margin-left: var(--space-xs);
      font-weight: 600; color: var(--color-primary, #6c63ff);
    }

    /* ── Investor badge in table ── */
    .badge--investor {
      background: color-mix(in srgb, var(--color-primary, #6c63ff) 15%, transparent);
      color: var(--color-primary, #6c63ff);
      border: 1px solid color-mix(in srgb, var(--color-primary, #6c63ff) 40%, transparent);
      font-size: 0.7rem; padding: 1px 5px; border-radius: 3px;
    }

    /* ── AR status badges ── */
    .badge--ar-paid {
      background: color-mix(in srgb, var(--color-success, #38a169) 15%, transparent);
      color: var(--color-success, #38a169);
      border: 1px solid color-mix(in srgb, var(--color-success, #38a169) 40%, transparent);
    }
    .badge--ar-partial {
      background: color-mix(in srgb, #d69e2e 12%, transparent);
      color: #d69e2e;
      border: 1px solid color-mix(in srgb, #d69e2e 35%, transparent);
    }
    .badge--ar-unpaid {
      background: color-mix(in srgb, var(--color-danger, #e53e3e) 12%, transparent);
      color: var(--color-danger, #e53e3e);
      border: 1px solid color-mix(in srgb, var(--color-danger, #e53e3e) 35%, transparent);
    }
    .ar-status-btn {
      cursor: pointer; display: inline-block;
      transition: opacity .15s;
    }
    .ar-status-btn:hover { opacity: 0.75; }

    /* ── Attachments ── */
    .sales-attach-section {
      border-top: 1px solid var(--color-border);
      margin-top: var(--space-lg); padding-top: var(--space-lg);
    }
    .sales-attach-list {
      display: flex; flex-direction: column;
      gap: var(--space-xs); margin-top: var(--space-sm);
    }
    .sales-attach-chip {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); background: var(--color-surface);
    }
    .sales-attach-icon { font-size: 1rem; flex-shrink: 0; }
    .sales-attach-name {
      flex: 1; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; font-size: 0.85rem;
    }
    .sales-attach-size { font-size: 0.75rem; color: var(--color-text-muted); flex-shrink: 0; }

    /* ════════════════════════════════════════
       AR MODAL
       ════════════════════════════════════════ */
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

    /* ── Summary bar ── */
    .ar-summary-bar {
      padding: var(--space-md) var(--space-xl);
      border-bottom: 1px solid var(--color-border);
      background: color-mix(in srgb, var(--color-surface) 60%, transparent);
    }
    .ar-summary-row {
      display: flex; gap: var(--space-lg); flex-wrap: wrap;
      margin-bottom: var(--space-sm); align-items: center;
    }
    .ar-summary-kpi { display: flex; flex-direction: column; gap: 2px; min-width: 110px; }
    .ar-summary-kpi__label {
      font-size: 0.72rem; color: var(--color-text-muted);
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .ar-summary-kpi__value {
      font-size: 1rem; font-weight: 700; color: var(--color-text);
    }
    .ar-summary-kpi__value--paid    { color: var(--color-success, #38a169); }
    .ar-summary-kpi__value--balance { color: var(--color-danger, #e53e3e); }

    /* Progress bar */
    .ar-progress-track {
      height: 6px; border-radius: 99px;
      background: var(--color-border);
      overflow: hidden;
    }
    .ar-progress-bar {
      height: 100%; border-radius: 99px;
      transition: width .4s ease;
    }
    .ar-progress--paid    { background: var(--color-success, #38a169); }
    .ar-progress--partial { background: #d69e2e; }
    .ar-progress--unpaid  { background: var(--color-danger, #e53e3e); }

    /* ── Sections ── */
    .ar-payments-section {
      padding: var(--space-md) var(--space-xl);
      border-bottom: 1px solid var(--color-border);
      flex: 1; overflow-y: auto;
    }
    .ar-add-section {
      padding: var(--space-md) var(--space-xl) var(--space-xl);
    }
    .ar-section-title {
      font-size: 0.78rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--color-text-muted);
      margin-bottom: var(--space-sm);
    }

    /* ── Payments table ── */
    .ar-payments-table { margin: 0; }
    .ar-payments-table th,
    .ar-payments-table td { padding: var(--space-xs) var(--space-sm); font-size: 0.85rem; }

    /* ── Add payment form grid ── */
    .ar-form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-md);
    }
    @media (max-width: 500px) {
      .ar-form-grid { grid-template-columns: 1fr; }
      .ar-modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
    }
  `;
  document.head.appendChild(tag);
}
