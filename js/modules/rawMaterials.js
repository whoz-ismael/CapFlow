/**
 * rawMaterials.js — CapFlow Raw Materials Module
 *
 * Handles all UI and interactions for raw material purchase tracking:
 *  - Register purchases (recycled resin or virgin pellet)
 *  - Monthly summary: total lbs, total cost, average cost/lb
 *  - Monthly closing inventory entry (modal)
 *  - Material balance: opening + purchases − closing = real consumption
 *  - Waste calculation vs. theoretical production usage
 *  - Inline provider creation via modal
 *  - Read-only cost helpers displayed below the form
 *
 * Data source: api.js → RawMaterialsAPI / ProvidersAPI / MonthlyInventoryAPI
 *                        / ProductionAPI (localStorage prototype).
 * All visible text: Spanish   |   All code identifiers: English
 */

import { RawMaterialsAPI }                  from '../api.js';
import { ProvidersAPI }                     from '../api.js';
import { MonthlyInventoryAPI }              from '../api.js';
import { ProductionAPI }                    from '../api.js';
import { MaterialReceiptsAPI }              from '../api.js';
import { getMaterialTypeLabel, getMaterialTypeBadge } from '../api.js';
import { InvestorAPI }                      from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** Record currently being edited, or null for create mode. */
let editingRecord = null;

/** In-memory cache of all purchase records — avoids re-fetching on every render. */
let allRecords = [];

/** In-memory cache of all providers — rebuilt after each provider save. */
let allProviders = [];

/** In-memory cache of all monthly closing inventory records. */
let allInventoryRecords = [];

/** In-memory cache of all production records (used for theoretical consumption). */
let allProductionRecords = [];

/** O(1) name lookup: supplierId → provider object. */
let providerMap = new Map();

/** In-memory cache of pending material receipts from operators. */
let allPendingReceipts = [];

/** The receipt currently being confirmed (confirm modal state). */
let confirmingReceipt = null;

/** YYYY-MM of the currently selected month summary. */
let selectedMonth = '';

/** Cached investor record — used to show/hide financing section. */
let investorRecord = null;

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Raw Materials module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export async function mountRawMaterials(container) {
  selectedMonth = currentMonthString();

  container.innerHTML = buildModuleHTML();
  attachFormListeners();
  attachProviderModalListeners();
  attachInventoryModalListeners();
  attachConfirmModalListeners();
  resetFormToCreateMode();

  await loadAll();
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

/**
 * Load both collections in parallel and refresh the full UI.
 * Called on mount and after every create / edit / delete.
 */
async function loadAll() {
  showTableLoading(true);

  try {
    [allRecords, allProviders, allInventoryRecords, allProductionRecords, allPendingReceipts, investorRecord] = await Promise.all([
      RawMaterialsAPI.getAll(),
      ProvidersAPI.getAll(),
      MonthlyInventoryAPI.getAll(),
      ProductionAPI.getAll(),
      MaterialReceiptsAPI.getPending(),
      InvestorAPI.get().catch(() => null),
    ]);

    // Rebuild lookup map: all providers (active + inactive) for name resolution
    providerMap = new Map(allProviders.map(p => [String(p.id), p]));

    // Show/hide investor financing section based on configuration
    renderInvestorSection();

    // Repopulate supplier dropdown with active providers only
    populateProviderSelect();

    // Render pending receipts section
    renderPendingReceipts();

    // Render table (newest first) and update badge
    const sorted = [...allRecords].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    renderTable(sorted);
    updateCountBadge(allRecords.length);

    // Render monthly summary + material balance
    renderMonthlySummary();

  } catch (err) {
    showFeedback(`Error al cargar datos: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// ─── HTML Shell ───────────────────────────────────────────────────────────────

/** Returns the full module markup as an HTML string. */
function buildModuleHTML() {
  const todayVal   = todayString();
  const monthLabel = formatMonthLabel(currentMonthString());

  return `
    <section class="module" id="raw-materials-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">⬢</span>
          <div>
            <h1 class="module-header__title">Materia Prima</h1>
            <p class="module-header__subtitle">Registro de compras y costo promedio mensual</p>
          </div>
        </div>
        <div class="module-header__badge" id="rm-count-badge">— registros</div>
      </header>

      <!-- ── Monthly Summary Card ── -->
      <div class="card" id="rm-summary-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">◈</span>
            Resumen mensual
          </h2>
          <div style="display:flex;align-items:center;gap:var(--space-sm);">
            <label class="form-label" for="rm-month-selector" style="margin:0;white-space:nowrap;">Mes:</label>
            <input
              class="form-input form-input--sm"
              type="month"
              id="rm-month-selector"
              value="${escapeHTML(currentMonthString())}"
              style="width:160px;"
            >
          </div>
        </div>
        <div class="rm-summary-grid" id="rm-summary-grid">
          <!-- Filled by renderMonthlySummary() -->
          <div class="rm-summary-stat">
            <span class="rm-summary-stat__value" id="rm-stat-lbs-recycled">—</span>
            <span class="rm-summary-stat__label">Lbs reciclado</span>
          </div>
          <div class="rm-summary-stat">
            <span class="rm-summary-stat__value" id="rm-stat-lbs-pellet">—</span>
            <span class="rm-summary-stat__label">Lbs pellet</span>
          </div>
          <div class="rm-summary-stat">
            <span class="rm-summary-stat__value" id="rm-stat-total-cost">—</span>
            <span class="rm-summary-stat__label">Costo total</span>
          </div>
          <div class="rm-summary-stat rm-summary-stat--accent">
            <span class="rm-summary-stat__value" id="rm-stat-avg-cost">—</span>
            <span class="rm-summary-stat__label">Costo prom / lb</span>
          </div>
        </div>
      </div>

      <!-- ── Closing Inventory Card ── -->
      <div class="card" id="rm-inventory-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">▣</span>
            Inventario de cierre
          </h2>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            id="rm-open-inventory-btn"
          >▣ Registrar / Editar inventario del mes</button>
        </div>
        <div class="rm-inventory-display" id="rm-inventory-display">
          <!-- Filled by renderMonthlySummary() after inventory data loads -->
          <div class="rm-inventory-row">
            <span class="rm-inventory-label">Reciclado (cierre)</span>
            <span class="rm-inventory-value" id="rm-inv-recycled">—</span>
          </div>
          <div class="rm-inventory-row">
            <span class="rm-inventory-label">Pellet (cierre)</span>
            <span class="rm-inventory-value" id="rm-inv-pellet">—</span>
          </div>
        </div>
      </div>

      <!-- ── Material Balance Card ── -->
      <div class="card" id="rm-balance-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">⊡</span>
            Balance de material
          </h2>
          <span class="rm-balance-month-label" id="rm-balance-month-label"></span>
        </div>
        <div id="rm-balance-body">
          <!-- Filled by renderMaterialBalance() -->
        </div>
      </div>

      <!-- ── Pending Receipts Card ── -->
      <div class="card" id="rm-pending-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">⏳</span>
            Entradas pendientes de operarios
            <span class="badge badge--warning" id="rm-pending-badge" style="display:none;">0</span>
          </h2>
        </div>
        <div id="rm-pending-body">
          <!-- Filled by renderPendingReceipts() -->
        </div>
      </div>

      <!-- ── Purchase Form Card ── -->
      <div class="card" id="rm-form-card">
        <div class="card__header">
          <h2 class="card__title" id="rm-form-title">
            <span class="card__title-icon">+</span>
            Nueva Compra
          </h2>
          <button class="btn btn--ghost btn--sm" id="rm-cancel-btn" style="display:none;">
            ✕ Cancelar
          </button>
        </div>

        <form id="rm-form" novalidate>
          <input type="hidden" id="rm-field-id">

          <div class="form-grid">

            <!-- Fecha -->
            <div class="form-group">
              <label class="form-label" for="rm-field-date">
                Fecha <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="date"
                id="rm-field-date"
                value="${escapeHTML(todayVal)}"
                required
              >
              <span class="form-error" id="rm-error-date"></span>
            </div>

            <!-- Tipo de material -->
            <div class="form-group">
              <label class="form-label" for="rm-field-type">
                Tipo de material <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="rm-field-type" required>
                  <option value="" disabled selected>Seleccionar tipo…</option>
                  <option value="recycled">Reciclado</option>
                  <option value="pellet">Pellet Virgen</option>
                  <option value="pellet_regular">Pellet</option>
                  <option value="colorant">Colorante</option>
                </select>
              </div>
              <span class="form-error" id="rm-error-type"></span>
            </div>

            <!-- Proveedor + inline new-provider button -->
            <div class="form-group">
              <label class="form-label" for="rm-field-supplier">
                Proveedor <span class="required">*</span>
              </label>
              <div style="display:flex;gap:var(--space-sm);align-items:flex-start;">
                <div class="select-wrapper" style="flex:1;">
                  <select class="form-input form-select" id="rm-field-supplier" required>
                    <option value="" disabled selected>Seleccionar proveedor…</option>
                  </select>
                </div>
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  id="rm-new-provider-btn"
                  title="Registrar nuevo proveedor"
                  style="white-space:nowrap;margin-top:2px;"
                >＋ Nuevo</button>
              </div>
              <span class="form-error" id="rm-error-supplier"></span>
            </div>

            <!-- Peso (lbs) -->
            <div class="form-group">
              <label class="form-label" for="rm-field-weight">
                Peso (lbs) <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="number"
                id="rm-field-weight"
                placeholder="0.00"
                min="0.01"
                step="0.01"
                required
              >
              <span class="form-error" id="rm-error-weight"></span>
            </div>

            <!-- Costo total -->
            <div class="form-group">
              <label class="form-label" for="rm-field-cost">
                Costo total (RD$) <span class="required">*</span>
              </label>
              <div class="input-prefix-wrapper">
                <span class="input-prefix">$</span>
                <input
                  class="form-input form-input--prefixed"
                  type="number"
                  id="rm-field-cost"
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  required
                >
              </div>
              <span class="form-error" id="rm-error-cost"></span>
            </div>

            <!-- Washing fields — shown only when type = recycled -->
            <div class="form-group" id="rm-washing-group" style="display:none;">
              <label class="form-label" for="rm-field-washed-weight">
                Peso lavado (lbs)
              </label>
              <input
                class="form-input"
                type="number"
                id="rm-field-washed-weight"
                placeholder="0.00"
                min="0"
                step="0.01"
              >
              <span class="form-error" id="rm-error-washed-weight"></span>
              <span class="form-hint">No puede superar el peso bruto.</span>
            </div>

            <div class="form-group" id="rm-washing-cost-group" style="display:none;">
              <label class="form-label" for="rm-field-washing-cost">
                Costo de lavado (RD$)
              </label>
              <div class="input-prefix-wrapper">
                <span class="input-prefix">$</span>
                <input
                  class="form-input form-input--prefixed"
                  type="number"
                  id="rm-field-washing-cost"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                >
              </div>
            </div>

          </div><!-- /form-grid -->

          <!-- ── Cost helper panel (UI only) ── -->
          <div class="rm-cost-panel" id="rm-cost-panel" style="display:none;">
            <div class="rm-cost-panel__item">
              <span class="rm-cost-panel__label">Costo por lb</span>
              <span class="rm-cost-panel__value" id="rm-calc-cost-per-lb">—</span>
            </div>
            <div class="rm-cost-panel__item" id="rm-calc-effective-wrap" style="display:none;">
              <span class="rm-cost-panel__label">Costo efectivo por lb (con lavado)</span>
              <span class="rm-cost-panel__value" id="rm-calc-effective-cost">—</span>
            </div>
          </div>

          <!-- Investor Financing (shown only when an investor record exists) -->
          <div class="rm-investor-section" id="rm-investor-section" style="display:none;">
            <label class="rm-investor-toggle">
              <input type="checkbox" id="rm-investor-check">
              <span class="rm-investor-toggle-label">
                <strong>Financiado por el inversionista</strong>
                <span class="form-hint" style="margin:0;">El monto se sumará a la deuda del inversionista</span>
              </span>
            </label>
            <div id="rm-investor-fields" style="display:none;" class="form-grid rm-investor-fields">
              <div class="form-group">
                <label class="form-label" for="rm-investor-amount">
                  Monto financiado (RD$) <span class="required">*</span>
                </label>
                <input class="form-input" type="number" id="rm-investor-amount"
                       min="0.01" step="0.01" placeholder="0.00">
                <span class="form-error" id="rm-investor-error"></span>
              </div>
              <div class="form-group">
                <label class="form-label" for="rm-investor-note">Nota (opcional)</label>
                <input class="form-input" type="text" id="rm-investor-note" maxlength="120"
                       placeholder="Ej: Préstamo para compra de material reciclado">
              </div>
            </div>
          </div>

          <!-- Form Actions -->
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="rm-submit-btn">
              <span class="btn__icon">＋</span>
              Guardar Compra
            </button>
          </div>
        </form>
      </div>

      <!-- ── Purchases Table Card ── -->
      <div class="card" id="rm-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Historial de compras
          </h2>
        </div>

        <div class="table-loading" id="rm-table-loading">
          <div class="spinner"></div>
          <span>Cargando registros…</span>
        </div>

        <div class="table-empty" id="rm-table-empty" style="display:none;">
          <span class="table-empty__icon">⬢</span>
          <p>No hay compras registradas aún.</p>
          <p class="table-empty__sub">Crea el primer registro usando el formulario de arriba.</p>
        </div>

        <div class="table-wrapper" id="rm-table-wrapper" style="display:none;">
          <table class="data-table" id="rm-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Proveedor</th>
                <th class="text-right">Peso (lbs)</th>
                <th class="text-right">Costo total</th>
                <th class="text-right">Costo / lb</th>
                <th class="text-right">Costo lavado</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="rm-tbody"></tbody>
          </table>
        </div>
      </div>

    </section>

    ${buildRawMaterialStyles()}
  `;
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

/**
 * Render an array of purchase records into the table body.
 * Called by loadAll() — always receives the full sorted array.
 * @param {Array} records
 */
function renderTable(records) {
  showTableLoading(false);

  const tbody   = document.getElementById('rm-tbody');
  const empty   = document.getElementById('rm-table-empty');
  const wrapper = document.getElementById('rm-table-wrapper');

  if (!records || records.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = records.map(buildTableRow).join('');

  // Wire row-level action buttons after injecting HTML
  // Edit and delete actions are disabled — purchases are immutable after creation.
}

/**
 * Build a single <tr> HTML string for one purchase record.
 * @param {Object} r - Raw material purchase record
 * @returns {string}
 */
function buildTableRow(r) {
  const typeLabel    = getMaterialTypeLabel(r.materialType || r.type);
  const typeBadge    = getMaterialTypeBadge(r.materialType || r.type);
  const costPerLb    = r.weightLbs > 0 ? r.totalCost / r.weightLbs : 0;
  const washingCost  = r.washingCost || 0;

  // Resolve supplier name — falls back to inactive notice or unknown
  const provider = providerMap.get(String(r.supplierId));
  let supplierDisplay;
  if (!provider) {
    supplierDisplay = `<span style="color:var(--color-text-muted);">[Proveedor eliminado]</span>`;
  } else if (provider.isActive === false) {
    supplierDisplay = `<span style="color:var(--color-warning);">[Proveedor inactivo]</span>`;
  } else {
    supplierDisplay = escapeHTML(provider.name);
  }

  const invBadge = r.investorFinancing
    ? `<span class="badge badge--orange" style="font-size:0.7rem;padding:2px 6px;"
         title="Financiado por el inversionista: ${formatCurrency(r.investorFinancing.amount)}">◈ INV</span>`
    : '';

  return `
    <tr class="table-row">
      <td class="td-date" style="font-family:var(--font-mono);font-size:0.82rem;white-space:nowrap;">
        ${escapeHTML(formatDateDisplay(r.date))}
      </td>
      <td><span class="badge ${typeBadge}">${typeLabel}</span>${invBadge ? ' ' + invBadge : ''}</td>
      <td>${supplierDisplay}</td>
      <td class="text-right" style="font-family:var(--font-mono);">
        ${formatNumber(r.weightLbs)}
      </td>
      <td class="text-right" style="font-family:var(--font-mono);">
        ${formatCurrency(r.totalCost)}
      </td>
      <td class="text-right" style="font-family:var(--font-mono);">
        ${formatCurrency(costPerLb)}
      </td>
      <td class="text-right" style="font-family:var(--font-mono);">
        ${washingCost > 0 ? formatCurrency(washingCost) : '<span style="color:var(--color-text-muted);">—</span>'}
      </td>
      <td class="text-center td-actions">
        <span
          class="badge badge--gray"
          style="font-size:0.7rem;padding:2px 8px;cursor:default;"
          title="Las compras no pueden editarse ni eliminarse una vez registradas"
        >⊘ Bloqueado</span>
      </td>
    </tr>
  `;
}

// ─── Investor Section ─────────────────────────────────────────────────────────

/** Show or hide the investor financing section based on whether an investor is configured. */
function renderInvestorSection() {
  const section = document.getElementById('rm-investor-section');
  if (!section) return;
  section.style.display = investorRecord ? '' : 'none';
}

// ─── Pending Receipts ─────────────────────────────────────────────────────────

/**
 * Render the pending receipts section with entries from CapDispatch operators.
 * Each row has a "Confirmar" button that opens the confirm modal.
 */
function renderPendingReceipts() {
  const body  = document.getElementById('rm-pending-body');
  const badge = document.getElementById('rm-pending-badge');
  const card  = document.getElementById('rm-pending-card');
  if (!body) return;

  const count = allPendingReceipts.length;

  // Update badge
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
  }

  if (count === 0) {
    body.innerHTML = `
      <div class="table-empty" style="display:flex;">
        <span class="table-empty__icon">✓</span>
        <p>No hay entradas pendientes de confirmar.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="table-wrapper" style="display:block;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Fecha entrada</th>
            <th>Tipo</th>
            <th class="text-right">Peso (lbs)</th>
            <th>Operario</th>
            <th>Notas</th>
            <th class="text-center">Acción</th>
          </tr>
        </thead>
        <tbody>
          ${allPendingReceipts.map(r => {
            const typeLabel = getMaterialTypeLabel(r.type);
            const typeBadge = getMaterialTypeBadge(r.type);
            return `
              <tr class="table-row">
                <td style="font-family:var(--font-mono);font-size:0.82rem;white-space:nowrap;">
                  ${escapeHTML(formatDateDisplay(r.receiptDate || r.date))}
                </td>
                <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
                <td class="text-right" style="font-family:var(--font-mono);">
                  ${formatNumber(r.weightLbs)}
                </td>
                <td>${escapeHTML(r.operatorName || '—')}</td>
                <td style="font-size:0.8rem;color:var(--color-text-muted);">
                  ${r.notes ? escapeHTML(r.notes) : '<span style="color:var(--color-text-muted);">—</span>'}
                </td>
                <td class="text-center">
                  <button
                    class="btn btn--primary btn--sm rm-confirm-receipt-btn"
                    data-receipt-id="${escapeHTML(r.id)}"
                    style="font-size:0.75rem;padding:4px 12px;"
                  >✔ Confirmar</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Wire confirm buttons
  body.querySelectorAll('.rm-confirm-receipt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const receiptId = btn.dataset.receiptId;
      const receipt   = allPendingReceipts.find(r => String(r.id) === String(receiptId));
      if (receipt) openConfirmModal(receipt);
    });
  });
}


// ─── Monthly Summary ──────────────────────────────────────────────────────────

/**
 * Calculate and render summary stats for the selected month.
 * Also triggers the material balance render which depends on the same month.
 * Reads `selectedMonth` (YYYY-MM) from module state.
 */
function renderMonthlySummary() {
  const monthRecords = allRecords.filter(r =>
    (r.date || '').startsWith(selectedMonth)
  );

  const lbsRecycled = monthRecords
    .filter(r => r.materialType === 'recycled')
    .reduce((s, r) => s + (r.weightLbs || 0), 0);

  const lbsPellet = monthRecords
    .filter(r => r.materialType === 'pellet')
    .reduce((s, r) => s + (r.weightLbs || 0), 0);

  const totalCost = monthRecords.reduce((s, r) =>
    s + (r.totalCost || 0) + (r.washingCost || 0), 0);

  const totalLbs = monthRecords.reduce((s, r) => s + (r.weightLbs || 0), 0);

  // averageCostPerLb = (totalCost + totalWashingCost) / totalWeightLbs
  const avgCostPerLb = totalLbs > 0 ? totalCost / totalLbs : 0;

  setText('rm-stat-lbs-recycled', formatNumber(lbsRecycled) + ' lbs');
  setText('rm-stat-lbs-pellet',   formatNumber(lbsPellet)   + ' lbs');
  setText('rm-stat-total-cost',   formatCurrency(totalCost));
  setText('rm-stat-avg-cost',     totalLbs > 0 ? formatCurrency(avgCostPerLb) + '/lb' : '—');

  // Render closing inventory display and material balance card
  renderClosingInventoryDisplay();
  renderMaterialBalance();
}

/**
 * Update the closing inventory display row values from in-memory records.
 * Uses normalizeMonth on both sides of the comparison so a record stored as
 * "2026-2" still matches selectedMonth "2026-02" and vice-versa.
 */
function renderClosingInventoryDisplay() {
  const normMonth = normalizeMonth(selectedMonth);
  const inv = allInventoryRecords.find(r => normalizeMonth(r.month) === normMonth);

  if (inv) {
    setText('rm-inv-recycled', formatNumber(inv.recycledClosingLbs) + ' lbs');
    setText('rm-inv-pellet',   formatNumber(inv.pelletClosingLbs)   + ' lbs');
  } else {
    setText('rm-inv-recycled', '—');
    setText('rm-inv-pellet',   '—');
  }
}

/**
 * Normalize a YYYY-MM string so the month part always has a leading zero.
 * Guards against browser quirks that may omit the zero (e.g. "2026-2").
 * Safe to call on already-normalized strings.
 * @param {string} month  - "YYYY-M" or "YYYY-MM"
 * @returns {string}       - "YYYY-MM"
 */
function normalizeMonth(month) {
  if (!month) return '';
  const [y, m] = month.split('-');
  return `${y}-${(m || '01').padStart(2, '0')}`;
}

/**
 * Return the YYYY-MM string of the month immediately before `ym`.
 * Handles year-boundary roll-back (e.g. 2026-01 → 2025-12).
 * Both input and output are normalised.
 * @param {string} ym  - "YYYY-MM" (or "YYYY-M" — normalised internally)
 * @returns {string}   - "YYYY-MM"
 */
function previousMonth(ym) {
  const norm  = normalizeMonth(ym);
  const [y, m] = norm.split('-').map(Number);
  // Construct the 1st of the given month, then subtract one month
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  const py = d.getFullYear();
  const pm = String(d.getMonth() + 1).padStart(2, '0');
  return `${py}-${pm}`;
}

/**
 * Calculate and render the Material Balance card.
 *
 * Formula (per type, then combined):
 *   opening    = previous month closing  (0 if not recorded)
 *   purchases  = sum(weightLbs) for type in selected month
 *   closing    = closing inventory for selected month  (0 if not recorded)
 *   consumed   = opening + purchases − closing
 *
 * Theoretical:
 *   theoreticalLbs = Σ(quantity × weightPerPackageSnapshot) from production records
 *
 * Waste:
 *   wasteLbs    = realConsumedTotal − theoreticalLbs
 *   wastePercent = (wasteLbs / theoreticalLbs) × 100
 */
function renderMaterialBalance() {
  const balanceBody = document.getElementById('rm-balance-body');
  if (!balanceBody) return;

  // ── Month label ────────────────────────────────────────────────────────────
  setText('rm-balance-month-label', formatMonthLabel(selectedMonth));

  // ── Inventory records — normalise both sides of every comparison ─────────────
  const normSelected = normalizeMonth(selectedMonth);
  const prevMonthStr = previousMonth(normSelected);          // already normalised
  const currInv = allInventoryRecords.find(r => normalizeMonth(r.month) === normSelected) || null;
  const prevInv = allInventoryRecords.find(r => normalizeMonth(r.month) === prevMonthStr) || null;

  // ── Purchase data for selected month ──────────────────────────────────────
  const monthPurchases = allRecords.filter(r => (r.date || '').startsWith(normSelected));

  const purchasedRecycled = monthPurchases
    .filter(r => r.materialType === 'recycled')
    .reduce((s, r) => s + (r.weightLbs || 0), 0);

  const purchasedPellet = monthPurchases
    .filter(r => r.materialType === 'pellet')
    .reduce((s, r) => s + (r.weightLbs || 0), 0);

  // ── Opening comes from previous month's closing; default 0 if not recorded ──
  const openingRecycled = prevInv ? (prevInv.recycledClosingLbs || 0) : 0;
  const openingPellet   = prevInv ? (prevInv.pelletClosingLbs   || 0) : 0;

  // ── Gate: if closing inventory is not recorded yet, show pending state ─────
  if (!currInv) {
    balanceBody.innerHTML = `
      <div class="rm-balance-grid">

        <!-- Left column: partial data available -->
        <div class="rm-balance-section">
          <div class="rm-balance-section__title">Flujo de material</div>

          <div class="rm-balance-row rm-balance-row--opening">
            <span class="rm-balance-row__op">+</span>
            <span class="rm-balance-row__label">Inventario inicial (lbs)</span>
            <span class="rm-balance-row__value">${formatNumber(openingRecycled + openingPellet)}</span>
          </div>
          <div class="rm-balance-row rm-balance-row--detail">
            <span class="rm-balance-row__op"></span>
            <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Reciclado</span>
            <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(openingRecycled)}</span>
          </div>
          <div class="rm-balance-row rm-balance-row--detail">
            <span class="rm-balance-row__op"></span>
            <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Pellet</span>
            <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(openingPellet)}</span>
          </div>

          <div class="rm-balance-row rm-balance-row--purchase">
            <span class="rm-balance-row__op">+</span>
            <span class="rm-balance-row__label">Compras del mes (lbs)</span>
            <span class="rm-balance-row__value">${formatNumber(purchasedRecycled + purchasedPellet)}</span>
          </div>
          <div class="rm-balance-row rm-balance-row--detail">
            <span class="rm-balance-row__op"></span>
            <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Reciclado</span>
            <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(purchasedRecycled)}</span>
          </div>
          <div class="rm-balance-row rm-balance-row--detail">
            <span class="rm-balance-row__op"></span>
            <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Pellet</span>
            <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(purchasedPellet)}</span>
          </div>

          <div class="rm-balance-row rm-balance-row--closing" style="opacity:0.4;">
            <span class="rm-balance-row__op">\u2212</span>
            <span class="rm-balance-row__label">Inventario de cierre (lbs)</span>
            <span class="rm-balance-row__value">\u2014</span>
          </div>

          <div class="rm-balance-row rm-balance-row--total" style="opacity:0.4;">
            <span class="rm-balance-row__op">=</span>
            <span class="rm-balance-row__label">Consumo real (lbs)</span>
            <span class="rm-balance-row__value">\u2014</span>
          </div>
        </div>

        <!-- Right column: pending state -->
        <div class="rm-balance-section">
          <div class="rm-balance-section__title">An\u00e1lisis de desperdicio</div>
          <div class="rm-balance-empty">
            <span class="rm-balance-empty__icon">\u25a6</span>
            <p>Cierre de inventario pendiente</p>
            <p class="rm-balance-empty__sub">
              Registra el inventario de cierre de ${escapeHTML(formatMonthLabel(selectedMonth))}
              para calcular el consumo real y el desperdicio.
            </p>
          </div>
        </div>

      </div>
    `;
    return;
  }

  // ── Closing is current month's recorded inventory ──────────────────────────
  const closingRecycled = currInv.recycledClosingLbs || 0;
  const closingPellet   = currInv.pelletClosingLbs   || 0;

  // ── Real consumption ───────────────────────────────────────────────────────
  const consumedRecycled = openingRecycled + purchasedRecycled - closingRecycled;
  const consumedPellet   = openingPellet   + purchasedPellet   - closingPellet;
  const consumedTotal    = consumedRecycled + consumedPellet;

  // ── Theoretical consumption from Production records ────────────────────────
  const monthProduction = allProductionRecords.filter(r =>
    (r.productionDate || '').startsWith(normSelected)
  );

  const theoreticalLbs = monthProduction.reduce((s, r) =>
    s + (r.quantity || 0) * (r.weightPerPackageSnapshot || 0), 0);

  const hasProduction = monthProduction.length > 0;

  // ── Waste ──────────────────────────────────────────────────────────────────
  const wasteLbs     = consumedTotal - theoreticalLbs;
  const wastePercent = theoreticalLbs > 0
    ? Math.round((wasteLbs / theoreticalLbs) * 10000) / 100  // 2 decimals
    : 0;

  // ── Waste colour class ─────────────────────────────────────────────────────
  let wasteClass = 'rm-balance-value--normal';
  if (wastePercent > 8)       wasteClass = 'rm-balance-value--danger';
  else if (wastePercent >= 3) wasteClass = 'rm-balance-value--warning';

  // ── Render ─────────────────────────────────────────────────────────────────
  balanceBody.innerHTML = `
    <div class="rm-balance-grid">

      <!-- Left column: material flow -->
      <div class="rm-balance-section">
        <div class="rm-balance-section__title">Flujo de material</div>

        <div class="rm-balance-row rm-balance-row--opening">
          <span class="rm-balance-row__op">+</span>
          <span class="rm-balance-row__label">Inventario inicial (lbs)</span>
          <span class="rm-balance-row__value">${formatNumber(openingRecycled + openingPellet)}</span>
        </div>
        <div class="rm-balance-row rm-balance-row--detail">
          <span class="rm-balance-row__op"></span>
          <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Reciclado</span>
          <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(openingRecycled)}</span>
        </div>
        <div class="rm-balance-row rm-balance-row--detail">
          <span class="rm-balance-row__op"></span>
          <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Pellet</span>
          <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(openingPellet)}</span>
        </div>

        <div class="rm-balance-row rm-balance-row--purchase">
          <span class="rm-balance-row__op">+</span>
          <span class="rm-balance-row__label">Compras del mes (lbs)</span>
          <span class="rm-balance-row__value">${formatNumber(purchasedRecycled + purchasedPellet)}</span>
        </div>
        <div class="rm-balance-row rm-balance-row--detail">
          <span class="rm-balance-row__op"></span>
          <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Reciclado</span>
          <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(purchasedRecycled)}</span>
        </div>
        <div class="rm-balance-row rm-balance-row--detail">
          <span class="rm-balance-row__op"></span>
          <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Pellet</span>
          <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(purchasedPellet)}</span>
        </div>

        <div class="rm-balance-row rm-balance-row--closing">
          <span class="rm-balance-row__op">\u2212</span>
          <span class="rm-balance-row__label">Inventario de cierre (lbs)</span>
          <span class="rm-balance-row__value">${formatNumber(closingRecycled + closingPellet)}</span>
        </div>
        <div class="rm-balance-row rm-balance-row--detail">
          <span class="rm-balance-row__op"></span>
          <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Reciclado</span>
          <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(closingRecycled)}</span>
        </div>
        <div class="rm-balance-row rm-balance-row--detail">
          <span class="rm-balance-row__op"></span>
          <span class="rm-balance-row__label rm-balance-row__label--sub">\u21b3 Pellet</span>
          <span class="rm-balance-row__value rm-balance-row__value--sub">${formatNumber(closingPellet)}</span>
        </div>

        <div class="rm-balance-row rm-balance-row--total">
          <span class="rm-balance-row__op">=</span>
          <span class="rm-balance-row__label">Consumo real (lbs)</span>
          <span class="rm-balance-row__value rm-balance-value--accent">${formatNumber(consumedTotal)}</span>
        </div>
      </div>

      <!-- Right column: waste analysis -->
      <div class="rm-balance-section">
        <div class="rm-balance-section__title">An\u00e1lisis de desperdicio</div>

        ${hasProduction ? `
          <div class="rm-balance-row">
            <span class="rm-balance-row__op"></span>
            <span class="rm-balance-row__label">Consumo real (lbs)</span>
            <span class="rm-balance-row__value">${formatNumber(consumedTotal)}</span>
          </div>
          <div class="rm-balance-row">
            <span class="rm-balance-row__op">\u2212</span>
            <span class="rm-balance-row__label">Uso te\u00f3rico por producci\u00f3n (lbs)</span>
            <span class="rm-balance-row__value">${formatNumber(theoreticalLbs)}</span>
          </div>
          <div class="rm-balance-row rm-balance-row--total">
            <span class="rm-balance-row__op">=</span>
            <span class="rm-balance-row__label">Desperdicio (lbs)</span>
            <span class="rm-balance-row__value ${wasteClass}">${formatNumber(wasteLbs)}</span>
          </div>
          <div class="rm-balance-row rm-balance-row--waste-pct">
            <span class="rm-balance-row__op"></span>
            <span class="rm-balance-row__label">Desperdicio (%)</span>
            <span class="rm-balance-row__value rm-balance-value--large ${wasteClass}">
              ${wastePercent.toFixed(2)} %
            </span>
          </div>
        ` : `
          <div class="rm-balance-empty">
            <span class="rm-balance-empty__icon">\u2b21</span>
            <p>Sin producci\u00f3n en este mes</p>
            <p class="rm-balance-empty__sub">
              Registra producci\u00f3n para calcular el uso te\u00f3rico y desperdicio.
            </p>
          </div>
        `}
      </div>

    </div>
  `;
}

// ─── Provider Dropdown ────────────────────────────────────────────────────────

/**
 * Repopulate the supplier <select> with active providers only.
 * Preserves the currently selected value when refreshing after a new save.
 */
function populateProviderSelect() {
  const select        = document.getElementById('rm-field-supplier');
  if (!select) return;

  const currentValue  = select.value;
  const activeProviders = allProviders
    .filter(p => p.isActive !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  // Rebuild option list, keeping the placeholder
  select.innerHTML = '<option value="" disabled>Seleccionar proveedor…</option>';

  activeProviders.forEach(p => {
    const opt   = document.createElement('option');
    opt.value   = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  // Restore selection if still valid
  if (currentValue) select.value = currentValue;
}

// ─── Cost Helper Panel ────────────────────────────────────────────────────────

/** Recalculate and display the UI-only cost helpers below the form. */
function updateCostPanel() {
  const weightRaw  = parseFloat(document.getElementById('rm-field-weight')?.value)       || 0;
  const costRaw    = parseFloat(document.getElementById('rm-field-cost')?.value)         || 0;
  const washRaw    = parseFloat(document.getElementById('rm-field-washing-cost')?.value) || 0;
  const isRecycled = document.getElementById('rm-field-type')?.value === 'recycled';

  const panel = document.getElementById('rm-cost-panel');
  if (!panel) return;

  if (weightRaw <= 0 || costRaw <= 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';

  const costPerLb     = costRaw / weightRaw;
  const effectiveCost = (costRaw + washRaw) / weightRaw;

  setText('rm-calc-cost-per-lb', formatCurrency(costPerLb) + '/lb');

  const effectiveWrap = document.getElementById('rm-calc-effective-wrap');
  if (effectiveWrap) {
    effectiveWrap.style.display = (isRecycled && washRaw > 0) ? '' : 'none';
  }
  setText('rm-calc-effective-cost', formatCurrency(effectiveCost) + '/lb');
}

// ─── Form Interactions ────────────────────────────────────────────────────────

/** Attach all form-level event listeners for the main purchase form. */
function attachFormListeners() {
  const form      = document.getElementById('rm-form');
  const cancelBtn = document.getElementById('rm-cancel-btn');
  const typeField = document.getElementById('rm-field-type');
  const monthSel  = document.getElementById('rm-month-selector');

  form.addEventListener('submit', handleFormSubmit);
  cancelBtn.addEventListener('click', resetFormToCreateMode);

  // Show / hide washing fields when material type changes
  typeField.addEventListener('change', () => {
    toggleWashingFields();
    updateCostPanel();
  });

  // Recalculate helpers on any numeric input change
  ['rm-field-weight', 'rm-field-cost', 'rm-field-washing-cost'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateCostPanel);
  });

  // Month selector re-renders summary without refetching
  monthSel.addEventListener('change', () => {
    selectedMonth = monthSel.value || currentMonthString();
    renderMonthlySummary();
  });

  // Investor financing checkbox — show/hide amount fields
  document.getElementById('rm-investor-check')
    ?.addEventListener('change', e => {
      const fields = document.getElementById('rm-investor-fields');
      if (fields) fields.style.display = e.target.checked ? '' : 'none';
      if (e.target.checked) {
        // Pre-fill with current total cost
        const cost = parseFloat(document.getElementById('rm-field-cost').value) || 0;
        const amtInput = document.getElementById('rm-investor-amount');
        if (amtInput && !amtInput.value) amtInput.value = cost > 0 ? cost : '';
      }
    });
}

/** Show or hide the washing fields based on the current material type. */
function toggleWashingFields() {
  const isRecycled = document.getElementById('rm-field-type')?.value === 'recycled';
  const show       = el => el && (el.style.display = '');
  const hide       = el => el && (el.style.display = 'none');

  isRecycled
    ? (show(document.getElementById('rm-washing-group')),
       show(document.getElementById('rm-washing-cost-group')))
    : (hide(document.getElementById('rm-washing-group')),
       hide(document.getElementById('rm-washing-cost-group')));
}

/**
 * Handle form submission — validate, call API, reload.
 * @param {Event} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) return;

  const submitBtn = document.getElementById('rm-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    const payload = collectFormData();

    if (editingRecord) {
      // Purchases are locked after creation to preserve inventory integrity.
      // This branch is kept for safety but the Edit button is removed from the UI.
      showFeedback(
        'Las compras no pueden editarse una vez registradas para mantener la integridad del inventario.',
        'warning',
        6000
      );
      resetFormToCreateMode();
      return;
    } else {
      // Validate investor financing amount before saving
      if (payload.investorFinancing && payload.investorFinancing.amount <= 0) {
        document.getElementById('rm-investor-error').textContent = 'El monto financiado debe ser mayor a 0.';
        setButtonLoading(submitBtn, false);
        return;
      }

      const newRecord = await RawMaterialsAPI.create(payload);

      // Record investor financing in the investor's history
      if (payload.investorFinancing && investorRecord) {
        const fin     = payload.investorFinancing;
        const noteInv = fin.note || `Materia prima: ${getMaterialTypeLabel(payload.materialType)} — ${payload.date}`;
        await InvestorAPI.addInvestment(fin.amount, noteInv, newRecord.id);
      }

      showFeedback('Compra registrada correctamente.', 'success');
    }

    resetFormToCreateMode();
    await loadAll();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Populate the form with an existing record and switch to edit mode.
 * @param {string} recordId
 */
function handleEdit(recordId) {
  const record = allRecords.find(r => String(r.id) === String(recordId));
  if (!record) return;

  editingRecord = record;

  document.getElementById('rm-field-id').value           = record.id;
  document.getElementById('rm-field-date').value         = record.date         || '';
  document.getElementById('rm-field-type').value         = record.materialType || '';
  document.getElementById('rm-field-supplier').value     = record.supplierId   || '';
  document.getElementById('rm-field-weight').value       = record.weightLbs    || '';
  document.getElementById('rm-field-cost').value         = record.totalCost    || '';
  document.getElementById('rm-field-washed-weight').value = record.washedWeightLbs || '';
  document.getElementById('rm-field-washing-cost').value  = record.washingCost    || '';

  toggleWashingFields();
  updateCostPanel();

  document.getElementById('rm-form-title').innerHTML = `
    <span class="card__title-icon">✎</span>
    Editar Compra
  `;
  document.getElementById('rm-submit-btn').innerHTML =
    '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('rm-cancel-btn').style.display = 'inline-flex';

  document.getElementById('rm-form-card').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Delete a purchase record after user confirmation.
 * @param {string} recordId
 */
async function handleDelete(recordId) {
  // Purchases cannot be deleted after creation because each one has generated
  // an inventory movement. Deleting the record without reversing the movement
  // would leave the inventory in an inconsistent state.
  // To correct a data entry error, use an Inventory adjustment directly.
  showFeedback(
    'Las compras no pueden eliminarse una vez registradas. Para corregir un error, realiza un ajuste de inventario.',
    'warning',
    8000
  );
}

/** Reset the form to "create new purchase" mode. */
function resetFormToCreateMode() {
  editingRecord = null;

  document.getElementById('rm-form').reset();
  document.getElementById('rm-field-id').value   = '';
  document.getElementById('rm-field-date').value = todayString();

  // Hide washing fields — only shown for recycled
  document.getElementById('rm-washing-group').style.display      = 'none';
  document.getElementById('rm-washing-cost-group').style.display = 'none';
  document.getElementById('rm-cost-panel').style.display         = 'none';

  // Restore form chrome
  document.getElementById('rm-form-title').innerHTML = `
    <span class="card__title-icon">+</span>
    Nueva Compra
  `;
  document.getElementById('rm-submit-btn').innerHTML =
    '<span class="btn__icon">＋</span> Guardar Compra';
  document.getElementById('rm-cancel-btn').style.display = 'none';

  // Reset investor financing section
  const invCheck  = document.getElementById('rm-investor-check');
  const invFields = document.getElementById('rm-investor-fields');
  if (invCheck)  invCheck.checked        = false;
  if (invFields) invFields.style.display = 'none';
  const invError = document.getElementById('rm-investor-error');
  if (invError)  invError.textContent    = '';

  clearFormErrors();
}

// ─── Confirm Receipt Modal ────────────────────────────────────────────────────

/**
 * Inject the confirm receipt modal into <body> once.
 * Idempotent via the id guard.
 */
function ensureConfirmModalInDOM() {
  if (document.getElementById('confirm-receipt-modal')) return;

  const el = document.createElement('div');
  el.innerHTML = `
    <div id="confirm-receipt-modal" class="provider-modal provider-modal--hidden"
         role="dialog" aria-modal="true" aria-labelledby="confirm-receipt-modal-title">

      <div class="provider-modal__backdrop" id="confirm-receipt-modal-backdrop"></div>

      <div class="provider-modal__window">

        <div class="provider-modal__header">
          <h3 class="provider-modal__title" id="confirm-receipt-modal-title">
            <span style="color:var(--color-accent);">✔</span>
            Confirmar entrada de materia prima
          </h3>
          <button
            class="provider-modal__close-btn"
            id="confirm-receipt-modal-close"
            aria-label="Cerrar modal"
            type="button"
          >✕</button>
        </div>

        <!-- Receipt summary (read-only) -->
        <div id="confirm-receipt-summary"
             style="margin:var(--space-md) var(--space-lg);padding:var(--space-md);
                    background:var(--color-accent-glow);border:1px solid var(--color-accent-border);
                    border-radius:var(--radius-md);font-size:0.85rem;line-height:1.8;">
        </div>

        <div class="provider-modal__body">
          <p style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:var(--space-md);">
            Completa los datos que el operario desconoce para registrar la compra.
          </p>

          <form id="rm-confirm-form" novalidate>
            <input type="hidden" id="rm-confirm-receipt-id">

            <!-- Fecha de compra -->
            <div class="form-group">
              <label class="form-label" for="rm-confirm-date">
                Fecha de compra <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="date"
                id="rm-confirm-date"
                required
              >
              <span class="form-error" id="rm-confirm-error-date"></span>
            </div>

            <!-- Proveedor -->
            <div class="form-group">
              <label class="form-label" for="rm-confirm-supplier">
                Proveedor <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="rm-confirm-supplier" required>
                  <option value="" disabled selected>Seleccionar proveedor…</option>
                </select>
              </div>
              <span class="form-error" id="rm-confirm-error-supplier"></span>
            </div>

            <!-- Costo total -->
            <div class="form-group">
              <label class="form-label" for="rm-confirm-cost">
                Costo total (RD$) <span class="required">*</span>
              </label>
              <div class="input-prefix-wrapper">
                <span class="input-prefix">$</span>
                <input
                  class="form-input form-input--prefixed"
                  type="number"
                  id="rm-confirm-cost"
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  required
                >
              </div>
              <span class="form-error" id="rm-confirm-error-cost"></span>
            </div>

            <!-- Washing fields — shown only when type = recycled -->
            <div class="form-group" id="rm-confirm-washing-group" style="display:none;">
              <label class="form-label" for="rm-confirm-washed-weight">
                Peso lavado (lbs)
              </label>
              <input
                class="form-input"
                type="number"
                id="rm-confirm-washed-weight"
                placeholder="0.00"
                min="0"
                step="0.01"
              >
              <span class="form-error" id="rm-confirm-error-washed-weight"></span>
              <span class="form-hint">No puede superar el peso bruto.</span>
            </div>

            <div class="form-group" id="rm-confirm-washing-cost-group" style="display:none;">
              <label class="form-label" for="rm-confirm-washing-cost">
                Costo de lavado (RD$)
              </label>
              <div class="input-prefix-wrapper">
                <span class="input-prefix">$</span>
                <input
                  class="form-input form-input--prefixed"
                  type="number"
                  id="rm-confirm-washing-cost"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                >
              </div>
            </div>

            <!-- Financiamiento del Inversionista -->
            <div class="rm-investor-section" id="rm-confirm-investor-section" style="display:none;">
              <label class="rm-investor-toggle">
                <input type="checkbox" id="rm-confirm-investor-check">
                <span class="rm-investor-toggle-label">
                  <strong>Financiado por el inversionista</strong>
                  <span class="form-hint" style="margin:0;">El monto se sumará a la deuda del inversionista</span>
                </span>
              </label>
              <div id="rm-confirm-investor-fields" style="display:none;" class="rm-investor-fields" style="margin-top:var(--space-md);">
                <div class="form-group">
                  <label class="form-label" for="rm-confirm-investor-amount">
                    Monto financiado (RD$) <span class="required">*</span>
                  </label>
                  <input class="form-input" type="number" id="rm-confirm-investor-amount"
                         min="0.01" step="0.01" placeholder="0.00">
                  <span class="form-error" id="rm-confirm-investor-error"></span>
                </div>
                <div class="form-group">
                  <label class="form-label" for="rm-confirm-investor-note">Nota (opcional)</label>
                  <input class="form-input" type="text" id="rm-confirm-investor-note" maxlength="120"
                         placeholder="Ej: Préstamo para compra de material">
                </div>
              </div>
            </div>

          </form>
        </div>

        <div class="provider-modal__footer">
          <button type="button" class="btn btn--ghost" id="confirm-receipt-modal-cancel">
            Cancelar
          </button>
          <button type="button" class="btn btn--primary" id="rm-confirm-submit-btn">
            <span class="btn__icon">✔</span> Confirmar compra
          </button>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(el.firstElementChild);
}

/**
 * Wire listeners for the confirm receipt modal.
 * Safe to call on each mount — uses named functions + remove/add.
 */
function attachConfirmModalListeners() {
  ensureConfirmModalInDOM();

  const close    = document.getElementById('confirm-receipt-modal-close');
  const cancel   = document.getElementById('confirm-receipt-modal-cancel');
  const backdrop = document.getElementById('confirm-receipt-modal-backdrop');
  const saveBtn  = document.getElementById('rm-confirm-submit-btn');
  const form     = document.getElementById('rm-confirm-form');

  close.removeEventListener('click', closeConfirmModal);
  close.addEventListener(   'click', closeConfirmModal);

  cancel.removeEventListener('click', closeConfirmModal);
  cancel.addEventListener(   'click', closeConfirmModal);

  backdrop.removeEventListener('click', closeConfirmModal);
  backdrop.addEventListener(   'click', closeConfirmModal);

  document.removeEventListener('keydown', _onConfirmModalEscape);
  document.addEventListener(   'keydown', _onConfirmModalEscape);

  saveBtn.removeEventListener('click', handleConfirmFormSubmit);
  saveBtn.addEventListener(   'click', handleConfirmFormSubmit);

  form.removeEventListener('submit', handleConfirmFormSubmit);
  form.addEventListener(   'submit', handleConfirmFormSubmit);

  // Investor financing checkbox — show/hide fields
  const invCheck = document.getElementById('rm-confirm-investor-check');
  if (invCheck) {
    invCheck.removeEventListener('change', _onConfirmInvestorCheckChange);
    invCheck.addEventListener(   'change', _onConfirmInvestorCheckChange);
  }
}

function _onConfirmModalEscape(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('confirm-receipt-modal');
    if (modal && !modal.classList.contains('provider-modal--hidden')) {
      closeConfirmModal();
    }
  }
}

function _onConfirmInvestorCheckChange(e) {
  const fields = document.getElementById('rm-confirm-investor-fields');
  if (fields) fields.style.display = e.target.checked ? '' : 'none';
  if (e.target.checked) {
    const cost = parseFloat(document.getElementById('rm-confirm-cost').value) || 0;
    const amtInput = document.getElementById('rm-confirm-investor-amount');
    if (amtInput && !amtInput.value) amtInput.value = cost > 0 ? cost : '';
  }
}

/**
 * Open the confirm receipt modal for a given receipt.
 * @param {Object} receipt
 */
function openConfirmModal(receipt) {
  ensureConfirmModalInDOM();
  confirmingReceipt = receipt;

  // Reset form
  document.getElementById('rm-confirm-form').reset();
  document.querySelectorAll('#rm-confirm-form .form-error')
    .forEach(el => (el.textContent = ''));

  // Show/hide investor section and reset its fields
  const invSection = document.getElementById('rm-confirm-investor-section');
  const invFields  = document.getElementById('rm-confirm-investor-fields');
  const invCheck   = document.getElementById('rm-confirm-investor-check');
  if (invSection) invSection.style.display = investorRecord ? '' : 'none';
  if (invFields)  invFields.style.display  = 'none';
  if (invCheck)   invCheck.checked         = false;

  // Pre-fill hidden id and date
  document.getElementById('rm-confirm-receipt-id').value = receipt.id;
  document.getElementById('rm-confirm-date').value = receipt.receiptDate || receipt.date || todayString();

  // Populate supplier dropdown
  const sel = document.getElementById('rm-confirm-supplier');
  sel.innerHTML = '<option value="" disabled selected>Seleccionar proveedor…</option>';
  allProviders
    .filter(p => p.isActive !== false)
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });

  // Show/hide washing fields based on type
  const isRecycled = receipt.type === 'recycled';
  document.getElementById('rm-confirm-washing-group').style.display      = isRecycled ? '' : 'none';
  document.getElementById('rm-confirm-washing-cost-group').style.display = isRecycled ? '' : 'none';

  // Show receipt summary
  const typeLabel = getMaterialTypeLabel(receipt.type);
  document.getElementById('confirm-receipt-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm);">
      <div><span style="color:var(--color-text-muted);">Tipo:</span> <strong>${escapeHTML(typeLabel)}</strong></div>
      <div><span style="color:var(--color-text-muted);">Peso:</span> <strong>${formatNumber(receipt.weightLbs)} lbs</strong></div>
      <div><span style="color:var(--color-text-muted);">Fecha entrada:</span> <strong>${escapeHTML(formatDateDisplay(receipt.receiptDate || receipt.date))}</strong></div>
      <div><span style="color:var(--color-text-muted);">Operario:</span> <strong>${escapeHTML(receipt.operatorName || '—')}</strong></div>
      ${receipt.notes ? `<div style="grid-column:1/-1;"><span style="color:var(--color-text-muted);">Notas:</span> ${escapeHTML(receipt.notes)}</div>` : ''}
    </div>
  `;

  const modal = document.getElementById('confirm-receipt-modal');
  modal.classList.remove('provider-modal--hidden');
  document.body.style.overflow = 'hidden';

  setTimeout(() => document.getElementById('rm-confirm-supplier')?.focus(), 50);
}

/** Close the confirm receipt modal and restore scroll. */
function closeConfirmModal() {
  const modal = document.getElementById('confirm-receipt-modal');
  if (!modal) return;
  modal.classList.add('provider-modal--hidden');
  document.body.style.overflow = '';
  confirmingReceipt = null;
}

/**
 * Handle confirm form submission — validate, call API, reload.
 * @param {Event} e
 */
async function handleConfirmFormSubmit(e) {
  if (e) e.preventDefault();

  if (!confirmingReceipt) return;

  // Validate
  const errors = [];
  const date        = document.getElementById('rm-confirm-date').value;
  const supplierId  = document.getElementById('rm-confirm-supplier').value;
  const cost        = parseFloat(document.getElementById('rm-confirm-cost').value);
  const washed      = parseFloat(document.getElementById('rm-confirm-washed-weight').value) || 0;
  const isRecycled  = confirmingReceipt.type === 'recycled';

  document.querySelectorAll('#rm-confirm-form .form-error')
    .forEach(el => (el.textContent = ''));

  if (!date) {
    document.getElementById('rm-confirm-error-date').textContent = 'La fecha es obligatoria.';
    errors.push('fecha');
  }
  if (!supplierId) {
    document.getElementById('rm-confirm-error-supplier').textContent = 'Selecciona un proveedor.';
    errors.push('proveedor');
  }
  if (!cost || cost <= 0) {
    document.getElementById('rm-confirm-error-cost').textContent = 'El costo debe ser mayor a 0.';
    errors.push('costo');
  }
  if (isRecycled && washed > 0 && washed > confirmingReceipt.weightLbs) {
    document.getElementById('rm-confirm-error-washed-weight').textContent =
      'El peso lavado no puede superar el peso bruto.';
    errors.push('peso lavado');
  }

  if (errors.length > 0) {
    showFeedback(`Verifica los campos: ${errors.join(', ')}.`, 'error');
    return;
  }

  const saveBtn = document.getElementById('rm-confirm-submit-btn');
  setButtonLoading(saveBtn, true);

  // Read investor financing fields
  const invChecked    = document.getElementById('rm-confirm-investor-check')?.checked && investorRecord;
  const invAmount     = invChecked
    ? (parseFloat(document.getElementById('rm-confirm-investor-amount').value) || 0)
    : 0;
  const invNote       = invChecked
    ? (document.getElementById('rm-confirm-investor-note').value.trim())
    : '';

  if (invChecked && invAmount <= 0) {
    const errEl = document.getElementById('rm-confirm-investor-error');
    if (errEl) errEl.textContent = 'El monto financiado debe ser mayor a 0.';
    showFeedback('Verifica el monto de financiamiento del inversionista.', 'error');
    return;
  }

  try {
    const newRecord = await MaterialReceiptsAPI.confirm(
      confirmingReceipt.id,
      {
        date,
        month:           date.slice(0, 7),
        supplierId,
        totalCost:       cost,
        washedWeightLbs: isRecycled ? washed : 0,
        washingCost:     isRecycled
          ? (parseFloat(document.getElementById('rm-confirm-washing-cost').value) || 0)
          : 0,
      },
      confirmingReceipt
    );

    // Record investor financing in the investor's history
    if (invChecked && invAmount > 0) {
      const typeLabel = getMaterialTypeLabel(confirmingReceipt.type);
      const note      = invNote || `Materia prima (recibo operario): ${typeLabel} — ${date}`;
      await InvestorAPI.addInvestment(invAmount, note, newRecord.id);
    }

    showFeedback('Entrada confirmada y compra registrada correctamente.', 'success');
    closeConfirmModal();
    await loadAll();

  } catch (err) {
    showFeedback(`Error al confirmar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(saveBtn, false);
  }
}


// ─── Inventory Modal ──────────────────────────────────────────────────────────

/**
 * Inject the closing inventory modal into <body> once.
 * The `id` guard makes this idempotent across re-mounts.
 */
function ensureInventoryModalInDOM() {
  if (document.getElementById('inventory-modal')) return;

  const el = document.createElement('div');
  el.innerHTML = `
    <div id="inventory-modal" class="provider-modal provider-modal--hidden"
         role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title">

      <div class="provider-modal__backdrop" id="inventory-modal-backdrop"></div>

      <div class="provider-modal__window">

        <div class="provider-modal__header">
          <h3 class="provider-modal__title" id="inventory-modal-title">
            <span style="color:var(--color-accent);">▣</span>
            Inventario de cierre
          </h3>
          <button
            class="provider-modal__close-btn"
            id="inventory-modal-close"
            aria-label="Cerrar modal"
            type="button"
          >✕</button>
        </div>

        <div class="provider-modal__body">
          <p style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:var(--space-md);">
            Registra las existencias físicas al cierre del mes seleccionado.
            Si ya existe un registro, se sobreescribirá.
          </p>

          <form id="rm-inv-form" novalidate>

            <!-- Mes -->
            <div class="form-group">
              <label class="form-label" for="rm-inv-month">
                Mes <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="month"
                id="rm-inv-month"
                required
              >
              <span class="form-error" id="rm-inv-error-month"></span>
            </div>

            <!-- Reciclado -->
            <div class="form-group">
              <label class="form-label" for="rm-inv-field-recycled">
                Reciclado — cierre (lbs) <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="number"
                id="rm-inv-field-recycled"
                placeholder="0.00"
                min="0"
                step="0.01"
                required
              >
              <span class="form-error" id="rm-inv-error-recycled"></span>
            </div>

            <!-- Pellet -->
            <div class="form-group">
              <label class="form-label" for="rm-inv-field-pellet">
                Pellet — cierre (lbs) <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="number"
                id="rm-inv-field-pellet"
                placeholder="0.00"
                min="0"
                step="0.01"
                required
              >
              <span class="form-error" id="rm-inv-error-pellet"></span>
            </div>

          </form>
        </div>

        <div class="provider-modal__footer">
          <button type="button" class="btn btn--ghost" id="inventory-modal-cancel">
            Cancelar
          </button>
          <button type="button" class="btn btn--primary" id="rm-inv-submit-btn">
            <span class="btn__icon">✔</span> Guardar inventario
          </button>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(el.firstElementChild);
}

/**
 * Wire all interactions for the inventory modal.
 * Called once per mount after ensureInventoryModalInDOM().
 */
function attachInventoryModalListeners() {
  ensureInventoryModalInDOM();

  // rm-open-inventory-btn lives inside the module container (wiped on each
  // mount) so it always gets a fresh listener — no de-registration needed.
  document.getElementById('rm-open-inventory-btn')
    .addEventListener('click', openInventoryModal);

  // All elements below live in <body> and survive router re-renders.
  // Remove before adding to prevent the same handler firing multiple times
  // after the user navigates away and back to this module.
  const close   = document.getElementById('inventory-modal-close');
  const cancel  = document.getElementById('inventory-modal-cancel');
  const backdrop= document.getElementById('inventory-modal-backdrop');
  const saveBtn = document.getElementById('rm-inv-submit-btn');
  const form    = document.getElementById('rm-inv-form');

  close.removeEventListener('click', closeInventoryModal);
  close.addEventListener(   'click', closeInventoryModal);

  cancel.removeEventListener('click', closeInventoryModal);
  cancel.addEventListener(   'click', closeInventoryModal);

  backdrop.removeEventListener('click', closeInventoryModal);
  backdrop.addEventListener(   'click', closeInventoryModal);

  // Escape key — already uses named function + remove/add
  document.removeEventListener('keydown', _onInventoryModalEscape);
  document.addEventListener(   'keydown', _onInventoryModalEscape);

  saveBtn.removeEventListener('click',  handleInventoryFormSubmit);
  saveBtn.addEventListener(   'click',  handleInventoryFormSubmit);

  form.removeEventListener('submit', handleInventoryFormSubmit);
  form.addEventListener(   'submit', handleInventoryFormSubmit);
}

/** Named Escape handler for inventory modal — avoids duplicate listeners. */
function _onInventoryModalEscape(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('inventory-modal');
    if (modal && !modal.classList.contains('provider-modal--hidden')) {
      closeInventoryModal();
    }
  }
}

/**
 * Open the inventory modal.
 * Pre-loads the existing record for selectedMonth if one exists.
 */
function openInventoryModal() {
  const modal = document.getElementById('inventory-modal');
  if (!modal) return;

  // Reset form first
  document.getElementById('rm-inv-form').reset();
  clearInventoryFormErrors();

  // Always use the normalised month as the form default
  const normMonth = normalizeMonth(selectedMonth);
  document.getElementById('rm-inv-month').value = normMonth;

  // Pre-fill from existing record — normalise both sides so a stale record
  // stored as "2026-2" still matches selectedMonth "2026-02"
  const existing = allInventoryRecords.find(
    r => normalizeMonth(r.month) === normMonth
  );
  if (existing) {
    document.getElementById('rm-inv-field-recycled').value = existing.recycledClosingLbs ?? '';
    document.getElementById('rm-inv-field-pellet').value   = existing.pelletClosingLbs   ?? '';
  }

  modal.classList.remove('provider-modal--hidden');
  document.body.style.overflow = 'hidden';

  setTimeout(() => document.getElementById('rm-inv-month')?.focus(), 50);
}

/** Close the inventory modal and restore body scroll. */
function closeInventoryModal() {
  const modal = document.getElementById('inventory-modal');
  if (!modal) return;

  modal.classList.add('provider-modal--hidden');
  document.body.style.overflow = '';
}

/**
 * Save (upsert) the closing inventory record for the chosen month.
 * On success: update allInventoryRecords in memory, re-render balance card,
 * close modal. No full loadAll() needed — calculations are in-memory.
 * @param {Event} e
 */
async function handleInventoryFormSubmit(e) {
  e.preventDefault();

  if (!validateInventoryForm()) return;

  const submitBtn = document.getElementById('rm-inv-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    // Read form values into locals BEFORE anything else touches the DOM.
    // The modal input IDs (rm-inv-field-*) are distinct from the display
    // span IDs (rm-inv-*) in the card, so getElementById returns the correct
    // <input> element in every case.
    const month              = normalizeMonth(document.getElementById('rm-inv-month').value);
    const recycledClosingLbs = parseFloat(document.getElementById('rm-inv-field-recycled').value) || 0;
    const pelletClosingLbs   = parseFloat(document.getElementById('rm-inv-field-pellet').value)   || 0;

    const payload = { month, recycledClosingLbs, pelletClosingLbs };

    const saved = await MonthlyInventoryAPI.upsert(payload);

    // Ensure the record we cache always has a normalized month string.
    // Use payload values as the authoritative source — they came straight
    // from the validated, parsed form inputs before any async gap.
    const record = {
      ...saved,
      month:              normalizeMonth(saved.month),
      recycledClosingLbs: payload.recycledClosingLbs,
      pelletClosingLbs:   payload.pelletClosingLbs,
    };

    // Direct replacement — no spread-merge ambiguity with stale cached data.
    const idx = allInventoryRecords.findIndex(r => r.month === record.month);
    if (idx >= 0) {
      allInventoryRecords[idx] = record;
    } else {
      allInventoryRecords.push(record);
    }

    showFeedback(
      `Inventario de cierre para ${formatMonthLabel(record.month)} guardado.`,
      'success'
    );

    closeInventoryModal();

    // Re-render immediately from the updated in-memory cache — no API call.
    renderClosingInventoryDisplay();
    renderMaterialBalance();

  } catch (err) {
    showFeedback(`Error al guardar inventario: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Validate the inventory modal form.
 * @returns {boolean}
 */
function validateInventoryForm() {
  clearInventoryFormErrors();
  let valid = true;

  const month    = document.getElementById('rm-inv-month').value;
  const recycled = document.getElementById('rm-inv-field-recycled').value;
  const pellet   = document.getElementById('rm-inv-field-pellet').value;

  if (!month) {
    showFieldError('rm-inv-error-month', 'El mes es obligatorio.');
    valid = false;
  }
  if (recycled === '' || Number(recycled) < 0) {
    showFieldError('rm-inv-error-recycled', 'Ingresa un valor mayor o igual a 0.');
    valid = false;
  }
  if (pellet === '' || Number(pellet) < 0) {
    showFieldError('rm-inv-error-pellet', 'Ingresa un valor mayor o igual a 0.');
    valid = false;
  }

  return valid;
}

/** Clear inline errors on the inventory modal form. */
function clearInventoryFormErrors() {
  document.querySelectorAll('#rm-inv-form .form-error')
    .forEach(el => (el.textContent = ''));
}

// ─── Provider Modal ───────────────────────────────────────────────────────────

/**
 * Inject the provider modal into <body> once and only once.
 *
 * The modal lives at the top of the stacking context — outside the module
 * container — so the router's container.innerHTML wipe can never destroy it.
 * The `id` guard makes this safe to call on every mount.
 */
function ensureProviderModalInDOM() {
  if (document.getElementById('provider-modal')) return; // already present

  const el = document.createElement('div');
  el.innerHTML = `
    <div id="provider-modal" class="provider-modal provider-modal--hidden"
         role="dialog" aria-modal="true" aria-labelledby="provider-modal-title">

      <!-- Dark backdrop — clicking it closes the modal -->
      <div class="provider-modal__backdrop" id="provider-modal-backdrop"></div>

      <!-- Floating window -->
      <div class="provider-modal__window">

        <div class="provider-modal__header">
          <h3 class="provider-modal__title" id="provider-modal-title">
            <span style="color:var(--color-accent);">◉</span>
            Nuevo Proveedor
          </h3>
          <button
            class="provider-modal__close-btn"
            id="provider-modal-close"
            aria-label="Cerrar modal"
            type="button"
          >✕</button>
        </div>

        <div class="provider-modal__body">
          <p style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:var(--space-md);">
            Los campos marcados con <span style="color:var(--color-accent);">*</span> son obligatorios.
          </p>

          <form id="rm-provider-form" novalidate>

            <!-- Nombre -->
            <div class="form-group">
              <label class="form-label" for="rm-prov-name">
                Nombre <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="rm-prov-name"
                placeholder="Ej: Reciclados del Norte"
                maxlength="120"
                autocomplete="off"
                required
              >
              <span class="form-error" id="rm-prov-error-name"></span>
            </div>

            <!-- Teléfono -->
            <div class="form-group">
              <label class="form-label" for="rm-prov-phone">
                Teléfono <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="rm-prov-phone"
                placeholder="Ej: 809-555-0100"
                maxlength="30"
                autocomplete="off"
                required
              >
              <span class="form-error" id="rm-prov-error-phone"></span>
            </div>

            <!-- Dirección -->
            <div class="form-group">
              <label class="form-label" for="rm-prov-address">Dirección</label>
              <input
                class="form-input"
                type="text"
                id="rm-prov-address"
                placeholder="Ej: Calle 5, Zona Industrial Norte"
                maxlength="200"
                autocomplete="off"
              >
              <span class="form-hint">Opcional.</span>
            </div>

          </form>
        </div>

        <div class="provider-modal__footer">
          <button type="button" class="btn btn--ghost" id="provider-modal-cancel">
            Cancelar
          </button>
          <button type="button" class="btn btn--primary" id="rm-prov-submit-btn">
            <span class="btn__icon">＋</span> Guardar Proveedor
          </button>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(el.firstElementChild);
}

/**
 * Wire all open / close / submit interactions for the provider modal.
 *
 * Must be called after ensureProviderModalInDOM() so every element exists.
 * Safe to call on each mount — addEventListener on the same function reference
 * does not double-register because we use named functions throughout.
 */
function attachProviderModalListeners() {
  ensureProviderModalInDOM();

  // rm-new-provider-btn lives inside the module container (wiped on each
  // mount) so it always gets a fresh listener — no de-registration needed.
  document.getElementById('rm-new-provider-btn')
    .addEventListener('click', openProviderModal);

  // All elements below live in <body> and survive router re-renders.
  // Remove before adding to prevent the same handler firing multiple times.
  const close   = document.getElementById('provider-modal-close');
  const cancel  = document.getElementById('provider-modal-cancel');
  const backdrop= document.getElementById('provider-modal-backdrop');
  const saveBtn = document.getElementById('rm-prov-submit-btn');
  const form    = document.getElementById('rm-provider-form');

  close.removeEventListener('click', closeProviderModal);
  close.addEventListener(   'click', closeProviderModal);

  cancel.removeEventListener('click', closeProviderModal);
  cancel.addEventListener(   'click', closeProviderModal);

  backdrop.removeEventListener('click', closeProviderModal);
  backdrop.addEventListener(   'click', closeProviderModal);

  // Escape key — named function + remove/add
  document.removeEventListener('keydown', _onProviderModalEscape);
  document.addEventListener(   'keydown', _onProviderModalEscape);

  saveBtn.removeEventListener('click',  handleProviderFormSubmit);
  saveBtn.addEventListener(   'click',  handleProviderFormSubmit);

  form.removeEventListener('submit', handleProviderFormSubmit);
  form.addEventListener(   'submit', handleProviderFormSubmit);
}

/** Named Escape handler — stored on module scope to allow removeEventListener. */
function _onProviderModalEscape(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('provider-modal');
    if (modal && !modal.classList.contains('provider-modal--hidden')) {
      closeProviderModal();
    }
  }
}

/**
 * Open the provider modal:
 * - Remove the hidden class (makes it visible)
 * - Lock body scroll so the page behind does not move
 * - Reset and focus the form
 */
function openProviderModal() {
  const modal = document.getElementById('provider-modal');
  if (!modal) return;

  document.getElementById('rm-provider-form').reset();
  clearProviderFormErrors();

  modal.classList.remove('provider-modal--hidden');
  document.body.style.overflow = 'hidden';

  // Focus first field after the CSS transition completes
  setTimeout(() => document.getElementById('rm-prov-name')?.focus(), 50);
}

/**
 * Close the provider modal:
 * - Re-add the hidden class (removes it from view without destroying DOM)
 * - Restore body scroll
 */
function closeProviderModal() {
  const modal = document.getElementById('provider-modal');
  if (!modal) return;

  modal.classList.add('provider-modal--hidden');
  document.body.style.overflow = '';
}

/**
 * Save a new provider, refresh the dropdown, and auto-select it.
 * Triggered by both the Save button click and native form submit (Enter key).
 * @param {Event} e
 */
async function handleProviderFormSubmit(e) {
  e.preventDefault();

  if (!validateProviderForm()) return;

  const submitBtn = document.getElementById('rm-prov-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    const payload = {
      name:    document.getElementById('rm-prov-name').value.trim(),
      phone:   document.getElementById('rm-prov-phone').value.trim(),
      address: document.getElementById('rm-prov-address').value.trim() || '',
    };

    const newProvider = await ProvidersAPI.create(payload);
    showFeedback(`Proveedor "${newProvider.name}" creado correctamente.`, 'success');

    closeProviderModal();

    // Refresh allProviders + map + dropdown, then auto-select the new provider
    allProviders = await ProvidersAPI.getAll();
    providerMap  = new Map(allProviders.map(p => [String(p.id), p]));
    populateProviderSelect();
    document.getElementById('rm-field-supplier').value = newProvider.id;

  } catch (err) {
    showFeedback(`Error al guardar proveedor: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Validate the main purchase form.
 * @returns {boolean} true if all fields are valid
 */
function validateForm() {
  clearFormErrors();
  const errors = [];

  const date       = document.getElementById('rm-field-date').value;
  const type       = document.getElementById('rm-field-type').value;
  const supplierId = document.getElementById('rm-field-supplier').value;
  const weight     = parseFloat(document.getElementById('rm-field-weight').value);
  const cost       = parseFloat(document.getElementById('rm-field-cost').value);
  const washed     = parseFloat(document.getElementById('rm-field-washed-weight').value) || 0;

  if (!date) {
    showFieldError('rm-error-date', 'La fecha es obligatoria.');
    errors.push('fecha');
  }
  if (!type) {
    showFieldError('rm-error-type', 'Selecciona el tipo de material.');
    errors.push('tipo');
  }
  if (!supplierId) {
    showFieldError('rm-error-supplier', 'Selecciona un proveedor.');
    errors.push('proveedor');
  }
  if (!weight || weight <= 0) {
    showFieldError('rm-error-weight', 'El peso debe ser mayor a 0.');
    errors.push('peso');
  }
  if (!cost || cost <= 0) {
    showFieldError('rm-error-cost', 'El costo debe ser mayor a 0.');
    errors.push('costo');
  }
  if (type === 'recycled' && washed > 0 && washed > weight) {
    showFieldError('rm-error-washed-weight', 'El peso lavado no puede superar el peso bruto.');
    errors.push('peso lavado');
  }

  if (errors.length > 0) {
    showFeedback(
      `Verifica los campos obligatorios: ${errors.join(', ')}.`,
      'error'
    );
    return false;
  }

  return true;
}

/**
 * Validate the provider modal form.
 * @returns {boolean}
 */
function validateProviderForm() {
  clearProviderFormErrors();
  let valid = true;

  const name  = document.getElementById('rm-prov-name').value.trim();
  const phone = document.getElementById('rm-prov-phone').value.trim();

  if (!name) {
    showFieldError('rm-prov-error-name', 'El nombre del proveedor es obligatorio.');
    valid = false;
  }
  if (!phone) {
    showFieldError('rm-prov-error-phone', 'El teléfono es obligatorio.');
    valid = false;
  }

  return valid;
}

/** Clear inline errors on the main purchase form. */
function clearFormErrors() {
  document.querySelectorAll('#rm-form .form-error')
    .forEach(el => (el.textContent = ''));
}

/** Clear inline errors on the provider modal form. */
function clearProviderFormErrors() {
  document.querySelectorAll('#rm-provider-form .form-error')
    .forEach(el => (el.textContent = ''));
}

/**
 * Show an inline error beneath a specific field.
 * @param {string} errorId
 * @param {string} message
 */
function showFieldError(errorId, message) {
  const el = document.getElementById(errorId);
  if (el) el.textContent = message;
}

// ─── Data Collector ───────────────────────────────────────────────────────────

/**
 * Collect all purchase form fields into a plain object ready for the API.
 * @returns {Object}
 */
function collectFormData() {
  const type       = document.getElementById('rm-field-type').value;
  const isRecycled = type === 'recycled';

  const investorChecked = document.getElementById('rm-investor-check')?.checked && investorRecord;
  const investorAmount  = investorChecked
    ? (parseFloat(document.getElementById('rm-investor-amount').value) || 0)
    : 0;
  const investorNote    = investorChecked
    ? (document.getElementById('rm-investor-note').value.trim())
    : '';

  return {
    date:         document.getElementById('rm-field-date').value,
    materialType: type,
    supplierId:   document.getElementById('rm-field-supplier').value,
    weightLbs:    parseFloat(document.getElementById('rm-field-weight').value)   || 0,
    totalCost:    parseFloat(document.getElementById('rm-field-cost').value)     || 0,
    // Recycled-only fields — always present in the record, default 0 for pellet
    washedWeightLbs: isRecycled
      ? (parseFloat(document.getElementById('rm-field-washed-weight').value) || 0)
      : 0,
    washingCost: isRecycled
      ? (parseFloat(document.getElementById('rm-field-washing-cost').value) || 0)
      : 0,
    // Investor financing (stored in extra JSONB column)
    investorFinancing: investorChecked ? { amount: investorAmount, note: investorNote } : null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Show / hide the table loading spinner.
 * @param {boolean} loading
 */
function showTableLoading(loading) {
  const loadEl    = document.getElementById('rm-table-loading');
  const wrapEl    = document.getElementById('rm-table-wrapper');
  const emptyEl   = document.getElementById('rm-table-empty');

  if (loadEl)  loadEl.style.display  = loading ? 'flex' : 'none';
  if (wrapEl)  wrapEl.style.display  = loading ? 'none' : '';
  if (emptyEl) emptyEl.style.display = 'none';
}

/**
 * Update the records count badge in the module header.
 * @param {number} total
 */
function updateCountBadge(total) {
  const badge = document.getElementById('rm-count-badge');
  if (badge) badge.textContent = `${total} registro${total !== 1 ? 's' : ''}`;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} [duration=4000]
 */
function showFeedback(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons  = { success: '✔', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast  = document.createElement('div');
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

/**
 * Put a button into loading state while an async operation runs.
 * @param {HTMLButtonElement} btn
 * @param {boolean} loading
 */
function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.dataset.originalText = btn.dataset.originalText || btn.innerHTML;
  btn.innerHTML = loading
    ? '<span class="spinner spinner--sm"></span> Guardando…'
    : btn.dataset.originalText;
}

/**
 * Set the textContent of an element by id — safe no-op if element not found.
 * @param {string} id
 * @param {string} text
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

/**
 * Returns today's date as YYYY-MM-DD in local time.
 * @returns {string}
 */
function todayString() {
  const d   = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the current month as YYYY-MM.
 * @returns {string}
 */
function currentMonthString() {
  return todayString().slice(0, 7);
}

/**
 * Format a YYYY-MM-DD string as a compact Spanish date.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateDisplay(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/**
 * Format a YYYY-MM string as a readable Spanish month + year label.
 * @param {string} ym
 * @returns {string}
 */
function formatMonthLabel(ym) {
  if (!ym) return '';
  const d = new Date(`${ym}-01T00:00:00`);
  if (isNaN(d)) return ym;
  return d.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
}

/**
 * Format a number as Dominican Peso currency.
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO', {
    style:                 'currency',
    currency:              'DOP',
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a number with locale-aware thousands separator.
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO').format(value);
}

// ─── Scoped CSS ───────────────────────────────────────────────────────────────

/**
 * Returns a <style> block for rawMaterials-specific classes.
 * Uses only CSS variables already defined in styles.css.
 * Injected alongside the module HTML — no external stylesheet needed.
 *
 * The provider modal styles use the `.provider-modal` namespace and are
 * injected once into <head> by ensureProviderModalStyles() so they remain
 * available even after the module container is wiped by the router.
 */
function buildRawMaterialStyles() {
  // Ensure modal CSS is in <head> so it survives router re-renders
  ensureProviderModalStyles();

  return `
    <style id="rm-styles">
      /* ── Monthly summary grid ── */
      .rm-summary-grid {
        display:   grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap:       1px;
        background: var(--color-border);
      }

      .rm-summary-stat {
        display:        flex;
        flex-direction: column;
        align-items:    center;
        gap:            4px;
        padding:        var(--space-lg);
        background:     var(--color-bg-card);
        text-align:     center;
      }

      .rm-summary-stat__value {
        font-family:    var(--font-display);
        font-size:      1.4rem;
        font-weight:    700;
        color:          var(--color-text-primary);
        letter-spacing: 0.02em;
      }

      .rm-summary-stat--accent .rm-summary-stat__value {
        color: var(--color-accent);
        filter: drop-shadow(0 0 6px var(--color-accent));
      }

      .rm-summary-stat__label {
        font-size:      0.72rem;
        color:          var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      /* ── Cost helper panel ── */
      .rm-cost-panel {
        display:         flex;
        flex-wrap:       wrap;
        gap:             var(--space-lg);
        padding:         var(--space-md) var(--space-lg);
        background:      var(--color-accent-glow);
        border-top:      1px solid var(--color-accent-border);
        border-bottom:   1px solid var(--color-accent-border);
        margin-bottom:   var(--space-md);
      }

      .rm-cost-panel__item {
        display:        flex;
        flex-direction: column;
        gap:            2px;
      }

      .rm-cost-panel__label {
        font-size:      0.72rem;
        color:          var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .rm-cost-panel__value {
        font-family: var(--font-mono);
        font-size:   0.95rem;
        color:       var(--color-accent);
        font-weight: 600;
      }

      /* ── Closing inventory display ── */
      .rm-inventory-display {
        padding: var(--space-md) var(--space-lg);
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-lg);
      }

      .rm-inventory-row {
        display:        flex;
        flex-direction: column;
        gap:            4px;
        min-width:      140px;
      }

      .rm-inventory-label {
        font-size:      0.72rem;
        color:          var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }

      .rm-inventory-value {
        font-family: var(--font-mono);
        font-size:   1.05rem;
        font-weight: 600;
        color:       var(--color-text-primary);
      }

      /* ── Material balance card ── */
      .rm-balance-month-label {
        font-size:      0.8rem;
        font-family:    var(--font-mono);
        color:          var(--color-text-muted);
        text-transform: capitalize;
      }

      .rm-balance-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap:     1px;
        background: var(--color-border);
      }

      @media (max-width: 680px) {
        .rm-balance-grid { grid-template-columns: 1fr; }
      }

      .rm-balance-section {
        background: var(--color-bg-card);
        padding:    var(--space-lg);
      }

      .rm-balance-section__title {
        font-family:    var(--font-display);
        font-size:      0.72rem;
        font-weight:    700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color:          var(--color-text-muted);
        margin-bottom:  var(--space-md);
        padding-bottom: var(--space-xs, 6px);
        border-bottom:  1px solid var(--color-border);
      }

      .rm-balance-row {
        display:     flex;
        align-items: baseline;
        gap:         var(--space-sm);
        padding:     5px 0;
        border-bottom: 1px solid transparent;
      }

      .rm-balance-row--total {
        border-top:    1px solid var(--color-border);
        margin-top:    4px;
        padding-top:   8px;
        font-weight:   700;
      }

      .rm-balance-row--waste-pct {
        padding-top: 6px;
      }

      .rm-balance-row__op {
        width:       14px;
        text-align:  center;
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size:   0.9rem;
        color:       var(--color-text-muted);
      }

      .rm-balance-row__label {
        flex: 1;
        font-size: 0.85rem;
        color:     var(--color-text-secondary);
      }

      .rm-balance-row__label--sub {
        font-size: 0.78rem;
        color:     var(--color-text-muted);
        padding-left: var(--space-sm);
      }

      .rm-balance-row__value {
        font-family: var(--font-mono);
        font-size:   0.88rem;
        text-align:  right;
        min-width:   80px;
        color:       var(--color-text-primary);
      }

      .rm-balance-row__value--sub {
        font-size: 0.78rem;
        color:     var(--color-text-muted);
      }

      /* Value colour states */
      .rm-balance-value--accent  { color: var(--color-accent); }
      .rm-balance-value--normal  { color: var(--color-text-primary); }
      .rm-balance-value--warning { color: var(--color-warning, #f39c12); }
      .rm-balance-value--danger  { color: var(--color-danger); }

      .rm-balance-value--large {
        font-size:   1.2rem;
        font-weight: 700;
      }

      /* Empty state for no-production scenario */
      .rm-balance-empty {
        display:        flex;
        flex-direction: column;
        align-items:    center;
        justify-content: center;
        padding:        var(--space-xl);
        text-align:     center;
        gap:            var(--space-sm);
        color:          var(--color-text-muted);
      }

      .rm-balance-empty__icon {
        font-size:   2.2rem;
        opacity:     0.4;
        display:     block;
        margin-bottom: 4px;
      }

      .rm-balance-empty__sub {
        font-size: 0.78rem;
        opacity:   0.7;
      }

      /* ── Investor financing section ── */
      .rm-investor-section {
        border-top: 1px solid var(--color-border);
        margin-top: var(--space-lg); padding-top: var(--space-lg);
      }
      .rm-investor-toggle {
        display: flex; align-items: flex-start; gap: var(--space-sm);
        cursor: pointer;
      }
      .rm-investor-toggle input[type="checkbox"] {
        margin-top: 2px; flex-shrink: 0; accent-color: var(--color-warning, #f59e0b);
      }
      .rm-investor-toggle-label {
        display: flex; flex-direction: column; gap: 2px;
      }
      .rm-investor-fields {
        margin-top: var(--space-md);
        padding: var(--space-md);
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 30%, transparent);
        border-radius: var(--radius-md);
      }
    </style>
  `;
}

/**
 * Inject the provider modal CSS into <head> once.
 * The `id` guard prevents duplicate injection across re-mounts.
 *
 * These styles are intentionally separate from the module's inline <style>
 * because the modal DOM lives in <body> and must outlive the module container.
 */
function ensureProviderModalStyles() {
  if (document.getElementById('provider-modal-styles')) return;

  const style = document.createElement('style');
  style.id = 'provider-modal-styles';
  style.textContent = `
    /* ── Provider overlay modal ─────────────────────────────────── */

    /* Outer shell: fixed full-screen layer, sits above everything   */
    .provider-modal {
      position:   fixed;
      inset:      0;               /* top/right/bottom/left: 0      */
      z-index:    9999;
      display:    flex;
      align-items:     center;
      justify-content: center;
    }

    /* Hidden state: taken out of paint entirely                      */
    .provider-modal--hidden {
      display: none;
    }

    /* Semi-transparent backdrop — clicking it closes the modal       */
    .provider-modal__backdrop {
      position:   absolute;
      inset:      0;
      background: rgba(0, 0, 0, 0.65);
      cursor:     pointer;
    }

    /* Floating window: sits on top of the backdrop via position rel  */
    .provider-modal__window {
      position:      relative;        /* above the absolute backdrop  */
      width:         460px;
      max-width:     92vw;
      max-height:    90vh;
      overflow-y:    auto;
      background:    var(--color-bg-card);
      border:        1px solid var(--color-border);
      border-top:    2px solid var(--color-accent-dim);
      border-radius: var(--radius-lg);
      box-shadow:    0 24px 60px rgba(0, 0, 0, 0.7),
                     0  4px 16px rgba(0, 0, 0, 0.5);
      display:       flex;
      flex-direction: column;
    }

    /* Header row: title + close button                               */
    .provider-modal__header {
      display:         flex;
      align-items:     center;
      justify-content: space-between;
      padding:         var(--space-md) var(--space-lg);
      background:      var(--color-bg-card-header);
      border-bottom:   1px solid var(--color-border);
      border-radius:   var(--radius-lg) var(--radius-lg) 0 0;
      flex-shrink:     0;
    }

    .provider-modal__title {
      font-family:    var(--font-display);
      font-size:      1.1rem;
      font-weight:    700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color:          var(--color-text-primary);
      display:        flex;
      align-items:    center;
      gap:            10px;
      margin:         0;
    }

    /* ✕ close button                                                 */
    .provider-modal__close-btn {
      background:    transparent;
      border:        1px solid var(--color-border);
      border-radius: 6px;
      color:         var(--color-text-muted);
      cursor:        pointer;
      font-size:     1rem;
      line-height:   1;
      padding:       4px 10px;
      transition:    color 0.15s, border-color 0.15s, background 0.15s;
    }

    .provider-modal__close-btn:hover {
      color:        var(--color-text-primary);
      border-color: var(--color-accent-border);
      background:   var(--color-accent-glow);
    }

    /* Scrollable form body                                           */
    .provider-modal__body {
      padding:    var(--space-lg);
      flex:       1;
      overflow-y: auto;
    }

    /* Footer: action buttons                                         */
    .provider-modal__footer {
      display:         flex;
      justify-content: flex-end;
      gap:             var(--space-sm);
      padding:         var(--space-md) var(--space-lg);
      background:      var(--color-bg-card-header);
      border-top:      1px solid var(--color-border);
      border-radius:   0 0 var(--radius-lg) var(--radius-lg);
      flex-shrink:     0;
    }
  `;
  document.head.appendChild(style);
}