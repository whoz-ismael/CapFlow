/**
 * sales.js — CapFlow Sales / Facturación Module
 *
 * Manages sale transactions:
 *   • Multi-line sale items (manufactured + resale products)
 *   • Attachment upload (PDF / image) stored as base64 DataURL
 *   • Automatic inventory deduction for manufactured lines via InventoryAPI
 *   • Monthly cost-per-package snapshot for manufactured lines
 *   • Safe edit (delta re-balance) and delete (full stock return)
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

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixed RD$ discount applied per manufactured package as investor benefit. */
const INVESTOR_BENEFIT_PER_PKG = 100;

/** Fixed RD$ debt paydown per manufactured package (while debt > 0). */
const INVESTOR_PAYDOWN_PER_PKG = 100;

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
            <label class="form-label" for="sale-field-invoice">N° Factura (opcional)</label>
            <input class="form-input" type="text" id="sale-field-invoice"
              placeholder="Ej: FAC-0001" maxlength="40">
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
    const [sales, clients, products, production, purchases, monthlyInv, investor] =
      await Promise.all([
        SalesAPI.getAll(),
        CustomersAPI.getAll(),
        ProductsAPI.getAll(),
        ProductionAPI.getAll(),
        RawMaterialsAPI.getAll(),
        MonthlyInventoryAPI.getAll(),
        InvestorAPI.get(),
      ]);

    allSales        = sales;
    allClients      = clients.filter(c => c.status === 'active');
    allClientsIndex = new Map(clients.map(c => [String(c.id), c]));
    productMap      = new Map(products.map(p => [String(p.id), p]));
    _allProduction  = production;
    _allPurchases   = purchases;
    _allMonthlyInv  = monthlyInv;
    investorRecord  = investor ?? null;

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

// ─── Filters & Table ──────────────────────────────────────────────────────────

function applyFilters() {
  const month    = (document.getElementById('sales-filter-month')?.value  || '').trim();
  const clientId =  document.getElementById('sales-filter-client')?.value || 'all';
  const query    = (document.getElementById('sales-search')?.value        || '').trim().toLowerCase();

  filterMonth    = month;
  filterClientId = clientId;
  searchQuery    = query;

  let results = allSales;
  if (month)              results = results.filter(s => s.month === month);
  if (clientId !== 'all') results = results.filter(s => String(s.clientId) === String(clientId));
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
}

function buildSaleRow(sale) {
  const client     = allClientsIndex.get(String(sale.clientId));
  const clientName = client ? escapeHTML(client.name)
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

  return `
    <tr class="table-row">
      <td>${escapeHTML(formatDate(sale.saleDate))}</td>
      <td>${invBadge}${clientName}</td>
      <td>${escapeHTML(sale.invoiceNumber || '—')}</td>
      <td class="text-right">${formatCurrency(t.revenue)}</td>
      <td class="text-right">${formatCurrency(t.cost)}</td>
      <td class="text-right"><span class="${profitCls}">${formatCurrency(t.profit)}</span></td>
      <td class="text-right">${marginPct}</td>
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
  document.getElementById('sales-search').addEventListener('input', applyFilters);

  document.getElementById('sale-file-input')
    .addEventListener('change', e => handleFileInput(e.target.files));

  document.getElementById('sale-field-date')
    .addEventListener('change', updateTotalsPreview);

  // Client change → refresh investor banner + totals
  document.getElementById('sale-field-client').addEventListener('change', () => {
    refreshInvestorBanner();
    updateTotalsPreview();
    // Refresh all row previews to update investor discount display
    document.querySelectorAll('#sales-lines-tbody .sale-line-row')
      .forEach(row => updateLinePreview(row));
  });

  document.getElementById('sales-table-card').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="view-attach"]');
    if (!btn) return;
    const sale = allSales.find(s => String(s.id) === String(btn.dataset.id));
    if (sale) viewAttachments(sale.attachments || []);
  });
}

// ─── Investor Helpers ─────────────────────────────────────────────────────────

/**
 * True if clientId matches the investor's customer record.
 */
function isInvestorSale(clientId) {
  return investorRecord !== null &&
    String(clientId || '') !== '' &&
    String(clientId) === String(investorRecord.clientId || '');
}

/**
 * Available investor debt for computing adjustments in the current form context.
 *
 * In edit mode the previously-applied amortization is added back so that
 * re-computation starts from the same pre-sale baseline as the original save.
 */
function effectiveInvestorDebt() {
  if (!investorRecord) return 0;
  const previousAmort = editingSale?.investor?.amortizationTotal || 0;
  return Math.max(0, (investorRecord.totalDebt || 0) + previousAmort);
}

/**
 * Apply investor pricing adjustments to enriched lines.
 *
 * Lines are processed in array order — earlier lines consume available debt first.
 * Only manufactured lines are eligible.
 *
 * @param {Array}  lines         - Enriched lines ({productType, quantity, lineRevenue,
 *                                  lineCost, lineProfit, …}). NOT mutated.
 * @param {number} availableDebt - Current investor debt available for paydown (≥ 0)
 * @returns {{ adjustedLines, amortizationTotal, benefitDiscountTotal }}
 */
function computeInvestorAdjustments(lines, availableDebt) {
  let remainingDebt        = Math.max(0, availableDebt);
  let amortizationTotal    = 0;
  let benefitDiscountTotal = 0;

  const adjustedLines = lines.map(line => {
    if (line.productType !== 'manufactured') {
      return { ...line, investorBenefit: 0, investorPaydown: 0 };
    }
    const qty             = line.quantity;
    const benefitDiscount = INVESTOR_BENEFIT_PER_PKG * qty;
    const paydownDiscount = Math.min(INVESTOR_PAYDOWN_PER_PKG * qty, remainingDebt);
    const totalDiscount   = benefitDiscount + paydownDiscount;

    remainingDebt        -= paydownDiscount;
    amortizationTotal    += paydownDiscount;
    benefitDiscountTotal += benefitDiscount;

    return {
      ...line,
      lineRevenue:     line.lineRevenue - totalDiscount,
      lineProfit:      line.lineProfit  - totalDiscount,
      investorBenefit: benefitDiscount,
      investorPaydown: paydownDiscount,
    };
  });

  return { adjustedLines, amortizationTotal, benefitDiscountTotal };
}

/**
 * Show or hide the investor banner based on the currently-selected client.
 * Updates the debt hint text inside the banner.
 */
function refreshInvestorBanner() {
  const banner   = document.getElementById('sales-investor-banner');
  const debtHint = document.getElementById('sales-investor-debt-hint');
  if (!banner) return;

  const clientId = document.getElementById('sale-field-client')?.value || '';
  const active   = isInvestorSale(clientId);
  banner.style.display = active ? 'flex' : 'none';

  if (active && debtHint) {
    const debt = effectiveInvestorDebt();
    debtHint.textContent = debt > 0
      ? `Deuda actual: ${formatCurrency(debt)}.`
      : 'Deuda saldada — solo aplica el descuento de beneficio.';
  }
}

// ─── Form Submit ──────────────────────────────────────────────────────────────

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const submitBtn = document.getElementById('sales-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    const saleDate      = document.getElementById('sale-field-date').value;
    const clientId      = document.getElementById('sale-field-client').value;
    const invoiceNumber = document.getElementById('sale-field-invoice').value.trim();
    const notes         = document.getElementById('sale-field-notes').value.trim();
    const month         = saleDate.slice(0, 7);

    const { costPerPackage: mfgCostPerPkg, missing: costMissing } =
      computeMonthlyCostPerPackage(month);

    // ── Build enriched lines (pre-investor) ───────────────────────────────────
    const rawLines = collectLines();
    let lines = rawLines.map((l, idx) => {
      const product     = productMap.get(String(l.productId));
      const pType       = product ? product.type : 'manufactured';
      const qty         = l.quantity;
      const price       = l.unitPrice;
      const lineRevenue = qty * price;
      const costPerUnit = pType === 'resale' ? l.resaleCost : mfgCostPerPkg;
      const lineCost    = qty * costPerUnit;
      return {
        id:                     `ln-${Date.now()}-${idx}`,
        productId:              l.productId,
        productType:            pType,
        quantity:               qty,
        unitPrice:              price,
        lineRevenue,
        costPerUnitSnapshot:    costPerUnit,
        lineCost,
        lineProfit:             lineRevenue - lineCost,
        resaleCostPerUnitInput: pType === 'resale' ? l.resaleCost : null,
        investorBenefit:        0,
        investorPaydown:        0,
      };
    });

    // ── Apply investor adjustments ────────────────────────────────────────────
    const investorSale = isInvestorSale(clientId);
    let amortizationTotal    = 0;
    let benefitDiscountTotal = 0;
    let investorPayload      = null;

    if (investorSale) {
      const adj = computeInvestorAdjustments(lines, effectiveInvestorDebt());
      lines                = adj.adjustedLines;
      amortizationTotal    = adj.amortizationTotal;
      benefitDiscountTotal = adj.benefitDiscountTotal;
      investorPayload      = { benefitDiscountTotal, amortizationTotal };
    }

    const totals = computeTotals(lines);
    const payload = {
      saleDate, clientId, invoiceNumber, notes,
      status: 'confirmed',
      totals, lines,
      attachments: [...currentAttachments],
      investor: investorPayload,
    };

    if (editingSale) {
      // ── EDIT PATH ─────────────────────────────────────────────────────────
      await applyInventoryDeltas(editingSale.lines, lines, editingSale.id);
      await SalesAPI.update(editingSale.id, payload);

      const wasInvestor = isInvestorSale(editingSale.clientId);
      if (investorSale) {
        // Still investor — reconcile amortization (handles same/more/less)
        await InvestorAPI.setSaleAmortization(
          editingSale.id,
          amortizationTotal,
          `Ajustado por edición de venta${invoiceNumber ? ' ' + invoiceNumber : ''}`
        );
      } else if (wasInvestor) {
        // Client changed away from investor — reverse all amortization for this sale
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

      // Inventory deductions for manufactured lines
      for (const line of lines) {
        if (line.productType !== 'manufactured') continue;
        const product = productMap.get(String(line.productId));
        if (!product) continue;
        const invItemId = await ensureProductInventoryItem(product);
        await InventoryAPI.removeStock(invItemId, line.quantity, newSale.id, 'Venta');
      }

      // Investor debt paydown
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
      resaleCost: isResale ? (line.resaleCostPerUnitInput ?? line.costPerUnitSnapshot) : '',
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

async function handleDelete(saleId) {
  const sale = allSales.find(s => String(s.id) === String(saleId));
  if (!sale) return;

  const client    = allClientsIndex.get(String(sale.clientId));
  const clientLbl = client ? client.name : '[Cliente eliminado]';
  const amortNote = sale.investor?.amortizationTotal > 0
    ? `\n\nSe revertirán ${formatCurrency(sale.investor.amortizationTotal)} de amortización de deuda.`
    : '';

  if (!confirm(
    `¿Eliminar la venta del ${formatDate(sale.saleDate)} para ${clientLbl}?` +
    `\n\nEsto devolverá el stock de productos manufacturados al inventario.${amortNote}`
  )) return;

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

    // Reverse investor amortization if this sale had any
    const hadAmort = (sale.investor?.amortizationTotal || 0) > 0;
    const wasInv   = isInvestorSale(sale.clientId);
    if (hadAmort || wasInv) {
      await InvestorAPI.clearSaleAmortization(saleId, 'Reversión por eliminación de venta');
    }

    await SalesAPI.remove(saleId);
    showFeedback('Venta eliminada y stock restaurado.', 'success');
    await loadAll();
  } catch (err) {
    showFeedback(`Error al eliminar: ${err.message}`, 'error');
  }
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
          <option value="" disabled ${!data.productId ? 'selected' : ''}>Seleccionar…</option>
          ${productOptions}
        </select>
      </div>
    </td>
    <td>
      <input class="form-input form-input--sm sl-qty" type="number"
        min="1" step="1" placeholder="0" style="width:80px;text-align:right;"
        value="${escapeHTML(String(data.quantity || ''))}">
    </td>
    <td>
      <input class="form-input form-input--sm sl-price" type="number"
        min="0" step="0.01" placeholder="0.00" style="width:100px;text-align:right;"
        value="${escapeHTML(String(data.unitPrice || ''))}">
    </td>
    <td>
      <input class="form-input form-input--sm sl-resale-cost" type="number"
        min="0" step="0.01" placeholder="0.00"
        style="width:100px;text-align:right;${resaleStyle}"
        value="${escapeHTML(String(data.resaleCost || ''))}">
      <span class="sl-mfg-cost-note"
        style="font-size:0.75rem;color:var(--color-text-muted);${mfgStyle}">del mes</span>
    </td>
    <td class="text-right sl-preview-revenue" style="font-size:0.85rem;">—</td>
    <td class="text-right sl-preview-cost"    style="font-size:0.85rem;">—</td>
    <td class="text-right sl-preview-profit"  style="font-size:0.85rem;">—</td>
    <td>
      <button type="button" class="btn btn--danger btn--xs sl-remove-btn"
        title="Eliminar línea">✕</button>
    </td>
  `;
}

function toggleResaleCostInput(rowEl) {
  const product  = productMap.get(String(rowEl.querySelector('.sl-product').value));
  const isResale = product ? product.type === 'resale' : false;
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

  // Show max investor discount in row preview (benefit + full paydown)
  // Totals preview is authoritative for the cumulative debt-cutoff logic.
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

  // Enrich with cost data
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

  // Investor discount rows
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
        'warning', 7000
      );
      continue;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      currentAttachments.push({
        id:      `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name:    file.name, mime: file.type, size: file.size,
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
    container.innerHTML = '<p class="form-hint" style="margin:0;">Sin archivos adjuntos.</p>';
    return;
  }

  container.innerHTML = currentAttachments.map(att => `
    <div class="sales-attach-chip">
      <span class="sales-attach-icon">${att.mime === 'application/pdf' ? '📄' : '🖼'}</span>
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
  return insufficient.length ? `Stock insuficiente:\n• ${insufficient.join('\n• ')}` : null;
}

async function applyInventoryDeltas(oldLines, newLines, saleId) {
  const oldMap = new Map();
  for (const line of (oldLines || [])) {
    if (line.productType !== 'manufactured') continue;
    const product = productMap.get(String(line.productId));
    if (!product) continue;
    const id = await ensureProductInventoryItem(product);
    oldMap.set(id, (oldMap.get(id) || 0) + line.quantity);
  }

  const newMap = new Map();
  for (const line of newLines) {
    if (line.productType !== 'manufactured') continue;
    const product = productMap.get(String(line.productId));
    if (!product) continue;
    const id = await ensureProductInventoryItem(product);
    newMap.set(id, (newMap.get(id) || 0) + line.quantity);
  }

  const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);

  const insufficient = [];
  for (const id of allIds) {
    const delta = (newMap.get(id) || 0) - (oldMap.get(id) || 0);
    if (delta <= 0) continue;
    const item = await InventoryAPI.getById(id);
    if (item && item.stock < delta) {
      insufficient.push(`${item.name || id}: necesario ${delta}, disponible ${item.stock}.`);
    }
  }
  if (insufficient.length) {
    throw new Error(`Stock insuficiente para el ajuste:\n• ${insufficient.join('\n• ')}`);
  }

  for (const id of allIds) {
    const delta = (newMap.get(id) || 0) - (oldMap.get(id) || 0);
    if (delta > 0) {
      await InventoryAPI.removeStock(id, delta, saleId, 'Ajuste por edición de venta');
    } else if (delta < 0) {
      await InventoryAPI.addStock(id, Math.abs(delta), saleId, 'Reverso por edición de venta');
    }
  }
}

// ─── Monthly Cost Calculation ─────────────────────────────────────────────────
// Mirror of dashboard.js formula — no cross-module import dependency.

function computeMonthlyCostPerPackage(month) {
  const monthRecs = _allProduction.filter(r => (r.productionDate || '').startsWith(month));
  const totalPkgs = monthRecs.reduce((s, r) => s + (r.quantity || 0), 0);
  const laborCost = monthRecs.reduce(
    (s, r) => s + (r.quantity || 0) * (r.operatorRateSnapshot || 0), 0
  );

  const prevMonth  = _prevMonthString(month);
  const currInv    = _allMonthlyInv.find(r => r.month === month) || null;
  const prevInv    = _allMonthlyInv.find(r => r.month === prevMonth) || null;
  const monthPurch = _allPurchases.filter(r => (r.date || '').startsWith(month));

  const materialCost = ['recycled', 'pellet'].reduce((acc, type) => {
    const tp       = monthPurch.filter(r => r.materialType === type);
    const pLbs     = tp.reduce((s, r) => s + (r.weightLbs || 0), 0);
    const pCost    = tp.reduce((s, r) => s + (r.totalCost || 0) + (r.washingCost || 0), 0);
    const avgCost  = pLbs > 0 ? pCost / pLbs : 0;
    const key      = type === 'recycled' ? 'recycledClosingLbs' : 'pelletClosingLbs';
    const openLbs  = prevInv ? (prevInv[key] || 0) : 0;
    const closeLbs = currInv ? (currInv[key] || 0) : 0;
    return acc + (openLbs + pLbs - closeLbs) * avgCost;
  }, 0);

  const totalCost      = laborCost + materialCost;
  const costPerPackage = totalPkgs > 0 ? totalCost / totalPkgs : 0;
  return { costPerPackage, missing: costPerPackage === 0 && totalPkgs === 0 };
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

    /* Investor banner */
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

    /* Investor badge in table */
    .badge--investor {
      background: color-mix(in srgb, var(--color-primary, #6c63ff) 15%, transparent);
      color: var(--color-primary, #6c63ff);
      border: 1px solid color-mix(in srgb, var(--color-primary, #6c63ff) 40%, transparent);
      font-size: 0.7rem; padding: 1px 5px; border-radius: 3px;
    }

    /* Attachments */
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
  `;
  document.head.appendChild(tag);
}