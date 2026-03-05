/**
 * dashboard.js — CapFlow Dashboard Module
 *
 * Renders a read-only KPI overview sourced entirely from ProductionAPI.
 * No charts, no external libraries — pure DOM + CSS variables already
 * defined in styles.css.
 *
 * KPIs displayed:
 *   Row 1 — Today   : shifts, quantity produced, value generated
 *   Row 2 — Month   : same metrics for the current calendar month
 *   Row 3 — Highlights: top operator (quantity) and most-used machine (shifts)
 *
 * VALUE FORMULA: record.quantity × record.productPriceSnapshot
 * Both fields are immutable snapshots stamped at creation — no recalculation
 * drift, no dependency on current product prices.
 *
 * All visible text: Spanish
 * All code identifiers: English
 * No business logic lives here.
 */

import { ProductionAPI }       from '../api.js';
import { OperatorsAPI }        from '../api.js';
import { MachinesAPI }         from '../api.js';
import { RawMaterialsAPI }     from '../api.js';
import { MonthlyInventoryAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/**
 * Holds the active Chart.js instance for the monthly production bar chart.
 * Destroyed and recreated on each renderMonth() call so stale canvas state
 * never bleeds into a fresh render.
 * @type {Chart|null}
 */
let monthlyChart = null;

/**
 * The month currently displayed in all KPI cards (YYYY-MM).
 * Controlled by the dashboard-month-selector input.
 * Defaults to the current calendar month on each mount.
 */
let selectedMonth = '';

/**
 * All five data collections fetched once per mount via Promise.all and cached
 * here so month-selector changes can re-filter without any extra API calls.
 */
let _allRecords   = [];          // all production records
let _allPurchases = [];          // all raw-material purchase records
let _allInventory = [];          // all monthly closing-inventory records
let _operatorMap  = new Map();   // operatorId → operator object
let _machineMap   = new Map();   // machineId  → machine object

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Dashboard module into the given container element.
 * Called by the router in app.js.
 *
 * Lifecycle:
 *   1. Render the structural shell (synchronous — user sees layout immediately)
 *   2. Set the month selector to the current month and wire its change handler
 *   3. Fetch all five data sources once via Promise.all and cache them
 *   4. Fill the static Today row (never changes with month selector)
 *   5. Delegate all month-specific KPIs to renderMonth(selectedMonth)
 *
 * @param {HTMLElement} container
 */
export async function mountDashboard(container) {
  // Default to the current calendar month before rendering the shell so the
  // input's value attribute is already correct when the HTML is injected.
  selectedMonth = todayString().slice(0, 7);

  container.innerHTML = buildShellHTML();

  // Ensure the selector shows the correct default (belt-and-suspenders
  // for browsers that do not respect the value attribute on type="month").
  const selector = document.getElementById('dashboard-month-selector');
  if (selector) {
    selector.value = selectedMonth;

    // Month-change handler: update state, show spinners, re-render KPIs.
    // No new API calls — all data is already cached in module-scope variables.
    selector.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      selectedMonth = val;
      showMonthSpinners();
      renderMonth(selectedMonth);
    });
  }

  try {
    // ── Single parallel fetch — results cached for the lifetime of this mount ─
    const [records, operators, machines, purchases, inventory] = await Promise.all([
      ProductionAPI.getAll(),
      OperatorsAPI.getAll(),
      MachinesAPI.getAll(),
      RawMaterialsAPI.getAll(),
      MonthlyInventoryAPI.getAll(),
    ]);

    // Cache everything at module scope so renderMonth() can re-filter without
    // any additional API calls when the user changes the month selector.
    _allRecords   = records;
    _allPurchases = purchases;
    _allInventory = inventory;
    _operatorMap  = new Map(operators.map(o => [String(o.id), o]));
    _machineMap   = new Map(machines.map(m  => [String(m.id), m]));

    // ── Today row — always reflects the actual calendar day, never changes ────
    const today        = todayString();
    const todayRecords = records.filter(r => r.productionDate === today);

    fillKPI('kpi-shifts-today',   formatNumber(todayRecords.length));
    fillKPI('kpi-quantity-today', formatNumber(sumField(todayRecords, 'quantity')));
    fillKPI('kpi-value-today',    formatCurrency(sumValue(todayRecords)));

    // Show the "no production data yet" notice if the entire store is empty.
    if (records.length === 0) {
      const notice = document.getElementById('dashboard-no-data');
      if (notice) notice.style.display = 'flex';
    }

    // ── Month row — delegated to renderMonth so it can be re-called on change ─
    renderMonth(selectedMonth);

  } catch (err) {
    container.innerHTML = `
      <section class="module">
        <header class="module-header">
          <div class="module-header__left">
            <span class="module-header__icon">⊞</span>
            <div>
              <h1 class="module-header__title">Dashboard</h1>
              <p class="module-header__subtitle">Resumen operativo</p>
            </div>
          </div>
        </header>
        <div class="card" style="padding:var(--space-xl);color:var(--color-danger);font-family:var(--font-mono);">
          ✕ Error cargando el dashboard: ${escapeHTML(err.message)}
        </div>
      </section>
    `;
  }
}

// ─── HTML Shell ───────────────────────────────────────────────────────────────

/**
 * Returns the full structural markup with empty KPI slots.
 * Rendered once on mount — values and dynamic labels are injected afterwards
 * by renderMonth() and the Today fill block.
 *
 * IDs used by renderMonth() for live updates:
 *   dashboard-month-selector  — the <input type="month">
 *   dashboard-month-card-title — "Mes · {label}" heading in the Month card
 *   dashboard-chart-title      — chart card heading (updated to show month)
 */
function buildShellHTML() {
  const today          = todayString();
  const ym             = today.slice(0, 7);
  const thisMonthLabel = formatMonthLabel(ym);

  return `
    <section class="module" id="dashboard-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">⊞</span>
          <div>
            <h1 class="module-header__title">Dashboard</h1>
            <p class="module-header__subtitle">Resumen operativo · ${escapeHTML(formatDateLabel(today))}</p>
          </div>
        </div>
        <label class="dashboard-month-label" for="dashboard-month-selector">
          Ver mes
          <input
            type="month"
            id="dashboard-month-selector"
            value="${escapeHTML(ym)}"
          >
        </label>
      </header>

      <!-- ── No-data notice (hidden until confirmed empty) ── -->
      <div id="dashboard-no-data" style="display:none;align-items:center;gap:12px;
           padding:var(--space-md) var(--space-lg);background:var(--color-accent-glow);
           border:1px solid var(--color-accent-border);border-radius:var(--radius-md);
           color:var(--color-text-secondary);font-size:0.85rem;">
        <span style="font-size:1.2rem;">ℹ</span>
        Sin datos de producción. Los KPIs se actualizarán al registrar el primer turno.
      </div>

      <!-- ── Row 1: Daily production chart (full-width) ── -->
      <div class="card" id="dashboard-chart-card">
        <div class="card__header">
          <h2 class="card__title" id="dashboard-chart-title">
            <span class="card__title-icon">▦</span>
            Producción diaria · ${escapeHTML(thisMonthLabel)}
          </h2>
        </div>
        <div class="dashboard-chart-wrap">
          <canvas id="monthly-production-chart" aria-label="Gráfico de producción diaria del mes"></canvas>
        </div>
      </div>

      <!-- ── Row 2: Today (static — always shows the actual calendar day) ── -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">◈</span>
            Hoy · ${escapeHTML(formatDateLabel(today))}
          </h2>
        </div>
        <div class="dashboard-kpi-row">
          ${buildKPICard('kpi-shifts-today',   '⇌', 'Turnos hoy',    'turnos')}
          ${buildKPICard('kpi-quantity-today',  '⊡', 'Cantidad hoy',  'unidades')}
          ${buildKPICard('kpi-value-today',     '$', 'Valor hoy',     'generado')}
        </div>
      </div>

      <!-- ── Row 3: Month (dynamic — controlled by month selector) ── -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title" id="dashboard-month-card-title">
            <span class="card__title-icon">◈</span>
            Mes · ${escapeHTML(thisMonthLabel)}
          </h2>
        </div>
        <div class="dashboard-kpi-row">
          ${buildKPICard('kpi-shifts-month',   '⇌', 'Turnos del mes',    'turnos')}
          ${buildKPICard('kpi-quantity-month',  '⊡', 'Cantidad del mes',  'unidades')}
          ${buildKPICard('kpi-value-month',     '$', 'Valor del mes',     'generado')}
          ${buildCostKPICard()}
        </div>
      </div>

      <!-- ── Row 4: Highlights (dynamic — controlled by month selector) ── -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">★</span>
            Destacados del mes
          </h2>
        </div>
        <div class="dashboard-kpi-row">
          ${buildHighlightCard('kpi-top-operator', '◈', 'Top operario del mes')}
          ${buildHighlightCard('kpi-top-machine',  '⬡', 'Máquina más utilizada')}
        </div>
      </div>

    </section>

    ${buildDashboardStyles()}
  `;
}

/**
 * Returns the HTML string for a single numeric KPI card slot.
 * @param {string} id       - Element id for the value <span>
 * @param {string} icon     - Decorative icon character
 * @param {string} label    - Card title (Spanish)
 * @param {string} subLabel - Small label below the value
 * @returns {string}
 */
function buildKPICard(id, icon, label, subLabel) {
  return `
    <div class="dashboard-kpi-card">
      <div class="dashboard-kpi-card__icon" aria-hidden="true">${icon}</div>
      <div class="dashboard-kpi-card__label">${escapeHTML(label)}</div>
      <div class="dashboard-kpi-card__value" id="${id}">
        <span class="kpi-loading"><span class="spinner spinner--sm"></span></span>
      </div>
      <div class="dashboard-kpi-card__sub">${escapeHTML(subLabel)}</div>
    </div>
  `;
}

/**
 * Returns the HTML string for a named-highlight card (operator / machine).
 * @param {string} id    - Root element id used by fillHighlight()
 * @param {string} icon
 * @param {string} label
 * @returns {string}
 */
function buildHighlightCard(id, icon, label) {
  return `
    <div class="dashboard-kpi-card dashboard-kpi-card--highlight" id="${id}">
      <div class="dashboard-kpi-card__icon" aria-hidden="true">${icon}</div>
      <div class="dashboard-kpi-card__label">${escapeHTML(label)}</div>
      <div class="dashboard-kpi-card__value">
        <span class="kpi-loading"><span class="spinner spinner--sm"></span></span>
      </div>
      <div class="dashboard-kpi-card__sub"></div>
    </div>
  `;
}

// ─── DOM Injection Helpers ────────────────────────────────────────────────────

/**
 * Write a resolved value into a numeric KPI card.
 * @param {string} id    - The element id set in buildKPICard()
 * @param {string} value - Pre-formatted string (formatNumber / formatCurrency)
 */
function fillKPI(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = escapeHTML(value);
}

/**
 * Write a name + sub-label into a highlight card.
 * If name is null the card shows the sub-label as a muted hint.
 * @param {string}      id       - The id set in buildHighlightCard()
 * @param {string|null} name     - Resolved name, or null if no data
 * @param {string}      subLabel - Context line beneath the name
 */
function fillHighlight(id, name, subLabel) {
  const card = document.getElementById(id);
  if (!card) return;

  const valueEl = card.querySelector('.dashboard-kpi-card__value');
  const subEl   = card.querySelector('.dashboard-kpi-card__sub');

  if (valueEl) {
    valueEl.innerHTML = name
      ? escapeHTML(name)
      : `<span style="color:var(--color-text-muted);font-size:0.85rem;">—</span>`;
  }
  if (subEl) {
    subEl.textContent = subLabel;
  }
}

// ─── Calculations ─────────────────────────────────────────────────────────────

/**
 * Sum a numeric field across an array of records.
 * @param {Array}  records
 * @param {string} field
 * @returns {number}
 */
function sumField(records, field) {
  return records.reduce((acc, r) => acc + (r[field] || 0), 0);
}

/**
 * Sum (quantity × productPriceSnapshot) across an array of records.
 * @param {Array} records
 * @returns {number}
 */
function sumValue(records) {
  return records.reduce(
    (acc, r) => acc + (r.quantity || 0) * (r.productPriceSnapshot || 0),
    0
  );
}

/**
 * Find the entity (by groupKey) with the highest total quantity.
 * Returns { id, total } or null if records is empty.
 * @param {Array}  records
 * @param {string} groupKey  - e.g. 'operatorId'
 * @returns {{ id: string, total: number }|null}
 */
function topByQuantity(records, groupKey) {
  if (!records.length) return null;

  const totals = new Map();
  for (const r of records) {
    const key = String(r[groupKey] || '');
    totals.set(key, (totals.get(key) || 0) + (r.quantity || 0));
  }

  let best = null;
  for (const [id, total] of totals) {
    if (!best || total > best.total) best = { id, total };
  }
  return best;
}

/**
 * Find the entity (by groupKey) with the highest record count.
 * Returns { id, count } or null if records is empty.
 * @param {Array}  records
 * @param {string} groupKey  - e.g. 'machineId'
 * @returns {{ id: string, count: number }|null}
 */
function topByCount(records, groupKey) {
  if (!records.length) return null;

  const counts = new Map();
  for (const r of records) {
    const key = String(r[groupKey] || '');
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let best = null;
  for (const [id, count] of counts) {
    if (!best || count > best.count) best = { id, count };
  }
  return best;
}

// ─── Month Rendering ─────────────────────────────────────────────────────────

/**
 * Reset all month-specific KPI cards to their loading-spinner state.
 *
 * Called immediately when the month selector changes so the user sees
 * instant feedback while renderMonth() synchronously recalculates.
 * (All calculations are in-memory, so the spinner is cleared almost instantly,
 * but showing it makes the update feel deliberate rather than a flash.)
 */
function showMonthSpinners() {
  const spinner = '<span class="kpi-loading"><span class="spinner spinner--sm"></span></span>';

  // Numeric KPI value slots
  ['kpi-shifts-month', 'kpi-quantity-month', 'kpi-value-month', 'kpi-cost-per-pkg']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = spinner;
    });

  // Hide the cost breakdown until fillCostKPI() reveals it again
  const breakdown = document.getElementById('kpi-cost-breakdown');
  if (breakdown) breakdown.style.display = 'none';

  // Highlight cards store their value in a child element
  ['kpi-top-operator', 'kpi-top-machine'].forEach(id => {
    const card    = document.getElementById(id);
    const valueEl = card?.querySelector('.dashboard-kpi-card__value');
    if (valueEl) valueEl.innerHTML = spinner;
  });
}

/**
 * Calculate and render all month-specific KPIs for the given month.
 *
 * This is a pure in-memory operation — it reads only from the module-scope
 * cache (_allRecords, _allPurchases, _allInventory, _operatorMap, _machineMap)
 * which was populated once during mountDashboard().
 *
 * Called on initial mount and every time the month selector changes.
 *
 * @param {string} month  - 'YYYY-MM'
 */
function renderMonth(month) {
  const monthLabel = formatMonthLabel(month);

  // ── Update dynamic heading labels ──────────────────────────────────────────
  const cardTitleEl  = document.getElementById('dashboard-month-card-title');
  const chartTitleEl = document.getElementById('dashboard-chart-title');

  if (cardTitleEl) {
    cardTitleEl.innerHTML =
      `<span class="card__title-icon">◈</span> Mes · ${escapeHTML(monthLabel)}`;
  }
  if (chartTitleEl) {
    chartTitleEl.innerHTML =
      `<span class="card__title-icon">▦</span> Producción diaria · ${escapeHTML(monthLabel)}`;
  }

  // ── Filter cached data to the selected month ───────────────────────────────
  const monthRecords = _allRecords.filter(r =>
    (r.productionDate || '').startsWith(month)
  );

  // ── Month KPIs ─────────────────────────────────────────────────────────────
  fillKPI('kpi-shifts-month',   formatNumber(monthRecords.length));
  fillKPI('kpi-quantity-month', formatNumber(sumField(monthRecords, 'quantity')));
  fillKPI('kpi-value-month',    formatCurrency(sumValue(monthRecords)));

  // ── Real cost per package ──────────────────────────────────────────────────
  // prevMonthString() inside calcMonthlyCostPerPackage uses the passed `month`
  // argument — never today's date — so opening inventory is always correct.
  const costData = calcMonthlyCostPerPackage(
    monthRecords, _allPurchases, _allInventory, month
  );
  fillCostKPI(costData);

  // ── Highlights ─────────────────────────────────────────────────────────────
  const topOperatorEntry = topByQuantity(monthRecords, 'operatorId');
  const topOperatorName  = topOperatorEntry
    ? (_operatorMap.get(String(topOperatorEntry.id))?.name || '[Operario eliminado]')
    : null;
  const topOperatorQty   = topOperatorEntry?.total ?? 0;

  const topMachineEntry  = topByCount(monthRecords, 'machineId');
  const topMachineName   = topMachineEntry
    ? (_machineMap.get(String(topMachineEntry.id))?.name || '[Máquina eliminada]')
    : null;
  const topMachineShifts = topMachineEntry?.count ?? 0;

  fillHighlight(
    'kpi-top-operator',
    topOperatorName,
    topOperatorName
      ? `${formatNumber(topOperatorQty)} unidades producidas este mes`
      : 'Sin datos de producción'
  );

  fillHighlight(
    'kpi-top-machine',
    topMachineName,
    topMachineName
      ? `${formatNumber(topMachineShifts)} turnos este mes`
      : 'Sin datos de producción'
  );

  // ── Chart ───────────────────────────────────────────────────────────────────
  renderMonthlyChart(buildDailyQuantityData(monthRecords, month));
}

// ─── Cost-per-Package Card Helpers ────────────────────────────────────────────

/**
 * Returns the HTML shell for the "Costo real por paquete" KPI card.
 * Includes three breakdown rows that are hidden until fillCostKPI() runs.
 * Follows the same structure as buildKPICard / buildHighlightCard.
 * @returns {string}
 */
function buildCostKPICard() {
  return `
    <div class="dashboard-kpi-card">
      <div class="dashboard-kpi-card__icon" aria-hidden="true">⊕</div>
      <div class="dashboard-kpi-card__label">Costo real por paquete</div>
      <div class="dashboard-kpi-card__value" id="kpi-cost-per-pkg">
        <span class="kpi-loading"><span class="spinner spinner--sm"></span></span>
      </div>
      <div class="dashboard-kpi-card__sub">del mes</div>
      <div class="dashboard-cost-breakdown" id="kpi-cost-breakdown" style="display:none;">
        <div class="dashboard-cost-breakdown__row">
          <span>Paquetes</span>
          <span id="kpi-cost-pkg-count">—</span>
        </div>
        <div class="dashboard-cost-breakdown__row">
          <span>Costo laboral</span>
          <span id="kpi-cost-labor">—</span>
        </div>
        <div class="dashboard-cost-breakdown__row">
          <span>Costo material</span>
          <span id="kpi-cost-material">—</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Inject computed cost values into the cost-per-package card.
 * Reveals the breakdown rows after data is ready.
 *
 * @param {{ totalPackages: number, totalLaborCost: number,
 *           totalMaterialCost: number, costPerPackage: number }} data
 */
function fillCostKPI({ totalPackages, totalLaborCost, totalMaterialCost, costPerPackage }) {
  fillKPI('kpi-cost-per-pkg', formatCurrency(costPerPackage));

  const breakdown = document.getElementById('kpi-cost-breakdown');
  if (!breakdown) return;

  const pkgEl = document.getElementById('kpi-cost-pkg-count');
  const labEl = document.getElementById('kpi-cost-labor');
  const matEl = document.getElementById('kpi-cost-material');

  if (pkgEl) pkgEl.textContent = formatNumber(totalPackages);
  if (labEl) labEl.textContent = formatCurrency(totalLaborCost);
  if (matEl) matEl.textContent = formatCurrency(totalMaterialCost);

  breakdown.style.display = '';
}

// ─── Cost Calculations ────────────────────────────────────────────────────────

/**
 * Calculate the real cost per package for a given month.
 *
 * Pure function — no DOM access, no side effects, O(n) over each input array.
 *
 * Cost components:
 *   Labor:    Σ(quantity × operatorRateSnapshot) for month production records
 *   Material: For each type (recycled / pellet):
 *               avgCostPerLb = Σ(totalCost + washingCost) / Σ(weightLbs)
 *               consumedLbs  = openingLbs + purchasedLbs − closingLbs
 *               materialCost = consumedLbs × avgCostPerLb
 *             Opening  = previous month's closing inventory (0 if not recorded)
 *             Closing  = current month's closing inventory  (0 if not recorded)
 *
 * @param {Array}  monthRecords      - Production records filtered to thisMonth
 * @param {Array}  allPurchases      - All raw-material purchase records
 * @param {Array}  inventoryRecords  - All monthly closing inventory records
 * @param {string} thisMonth         - 'YYYY-MM'
 * @returns {{ totalPackages: number, totalLaborCost: number,
 *             totalMaterialCost: number, totalCost: number,
 *             costPerPackage: number }}
 */
function calcMonthlyCostPerPackage(monthRecords, allPurchases, inventoryRecords, thisMonth) {
  // ── Production totals ──────────────────────────────────────────────────────
  const totalPackages  = sumField(monthRecords, 'quantity');
  const totalLaborCost = monthRecords.reduce(
    (acc, r) => acc + (r.quantity || 0) * (r.operatorRateSnapshot || 0),
    0
  );

  // ── Inventory lookups (opening = prev month closing; closing = this month) ─
  const prevMonth = prevMonthString(thisMonth);
  const currInv   = inventoryRecords.find(r => r.month === thisMonth) || null;
  const prevInv   = inventoryRecords.find(r => r.month === prevMonth) || null;

  // ── Material cost: recycled + pellet calculated independently ─────────────
  const monthPurchases = allPurchases.filter(
    r => (r.date || '').startsWith(thisMonth)
  );

  const totalMaterialCost = ['recycled', 'pellet'].reduce((acc, type) => {
    const typePurchases = monthPurchases.filter(r => r.materialType === type);

    // Weighted average cost per lb for this type this month
    const purchasedLbs  = typePurchases.reduce((s, r) => s + (r.weightLbs || 0), 0);
    const purchasedCost = typePurchases.reduce(
      (s, r) => s + (r.totalCost || 0) + (r.washingCost || 0),
      0
    );
    const avgCostPerLb  = purchasedLbs > 0 ? purchasedCost / purchasedLbs : 0;

    // Closing-inventory field name matches the API record shape
    const closingKey    = type === 'recycled' ? 'recycledClosingLbs' : 'pelletClosingLbs';
    const openingLbs    = prevInv ? (prevInv[closingKey] || 0) : 0;
    const closingLbs    = currInv ? (currInv[closingKey] || 0) : 0;

    // Consumed = opening + purchased − closing  (same formula as rawMaterials.js)
    const consumedLbs   = openingLbs + purchasedLbs - closingLbs;

    return acc + consumedLbs * avgCostPerLb;
  }, 0);

  const totalCost      = totalLaborCost + totalMaterialCost;
  const costPerPackage = totalPackages > 0 ? totalCost / totalPackages : 0;

  return { totalPackages, totalLaborCost, totalMaterialCost, totalCost, costPerPackage };
}

/**
 * Return the YYYY-MM string of the month immediately before `ym`.
 * Handles year-boundary rollover (e.g. 2026-01 → 2025-12).
 * @param {string} ym  - 'YYYY-MM'
 * @returns {string}   - 'YYYY-MM'
 */
function prevMonthString(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d      = new Date(y, m - 1, 1);  // 1st of ym
  d.setMonth(d.getMonth() - 1);           // roll back one month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

/**
 * Returns today's date as a YYYY-MM-DD string in local time.
 * Uses toLocaleDateString to avoid UTC midnight shift.
 * @returns {string}
 */
function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a YYYY-MM-DD string as a readable Spanish date.
 * e.g. "2025-03-15" → "15 mar 2025"
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/**
 * Format a YYYY-MM string as a readable Spanish month + year.
 * e.g. "2025-03" → "marzo 2025"
 * @param {string} ym  - 'YYYY-MM'
 * @returns {string}
 */
function formatMonthLabel(ym) {
  if (!ym) return '';
  const d = new Date(`${ym}-01T00:00:00`);
  if (isNaN(d)) return ym;
  return d.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
}

/**
 * Format a number as Dominican Peso (RD$) currency.
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
 * Format an integer with locale-aware thousands separator.
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO').format(value);
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

// ─── Chart Data & Rendering ───────────────────────────────────────────────────

/**
 * Build the labels and dataset for the daily-quantity bar chart.
 *
 * Produces one entry per calendar day in the given month (1 → daysInMonth),
 * with quantity summed across all records that fall on that day.
 * Days with no production appear with value 0 — the full x-axis is always shown.
 *
 * @param {Array}  monthRecords - Records already filtered to the current month
 * @param {string} yearMonth    - 'YYYY-MM'
 * @returns {{ labels: string[], data: number[] }}
 */
function buildDailyQuantityData(monthRecords, yearMonth) {
  // Determine how many days are in the month
  const [y, m]    = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this

  // Accumulate quantity per day number (1-indexed)
  const dayTotals = new Array(daysInMonth + 1).fill(0); // index 0 unused

  for (const r of monthRecords) {
    const day = parseInt((r.productionDate || '').slice(8, 10), 10);
    if (day >= 1 && day <= daysInMonth) {
      dayTotals[day] += (r.quantity || 0);
    }
  }

  const labels = [];
  const data   = [];
  for (let d = 1; d <= daysInMonth; d++) {
    labels.push(String(d));
    data.push(dayTotals[d]);
  }

  return { labels, data };
}

/**
 * Create (or recreate) the Chart.js bar chart on the #monthly-production-chart canvas.
 *
 * Destroys any previous instance stored in `monthlyChart` so stale canvas
 * state is cleared on dashboard re-mount.
 * Falls back silently if Chart.js is not yet loaded (CDN delay) or the
 * canvas element is not in the DOM.
 *
 * Theme: dark-industrial — matches CapFlow's existing CSS variable palette.
 *
 * @param {{ labels: string[], data: number[] }} chartData
 */
function renderMonthlyChart({ labels, data }) {
  // Guard: Chart.js must be available on window (CDN script)
  if (typeof window.Chart === 'undefined') {
    console.warn('[CapFlow Dashboard] Chart.js not loaded — chart skipped.');
    return;
  }

  const canvas = document.getElementById('monthly-production-chart');
  if (!canvas) return;

  // Destroy previous instance to release the canvas context
  if (monthlyChart) {
    monthlyChart.destroy();
    monthlyChart = null;
  }

  // Resolve CSS variable values for chart colours
  // getComputedStyle reads the actual pixel values from :root at runtime
  const style       = getComputedStyle(document.documentElement);
  const accentColor = style.getPropertyValue('--color-accent').trim()       || '#4a9eff';
  const accentGlow  = style.getPropertyValue('--color-accent-glow').trim()  || 'rgba(74,158,255,0.15)';
  const borderColor = style.getPropertyValue('--color-border').trim()       || '#252e42';
  const textMuted   = style.getPropertyValue('--color-text-muted').trim()   || '#4a556b';
  const textPrimary = style.getPropertyValue('--color-text-primary').trim() || '#dce4f0';
  const fontDisplay = style.getPropertyValue('--font-display').trim()       || 'sans-serif';

  monthlyChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           'Cantidad producida',
        data,
        backgroundColor: accentGlow,
        borderColor:     accentColor,
        borderWidth:     1.5,
        borderRadius:    3,
        hoverBackgroundColor: accentColor,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled:     true,
          callbacks: {
            title:  items  => `Día ${items[0].label}`,
            label:  item   => ` ${new Intl.NumberFormat('es-DO').format(item.raw)} unidades`,
          },
          backgroundColor: '#1c2333',
          titleColor:      textPrimary,
          bodyColor:       accentColor,
          borderColor:     borderColor,
          borderWidth:     1,
        },
      },
      scales: {
        x: {
          title: {
            display:  true,
            text:     'Día',
            color:    textMuted,
            font:     { family: fontDisplay, size: 11, weight: '600' },
          },
          ticks: {
            color:    textMuted,
            maxTicksLimit: 31,
          },
          grid: {
            color:    borderColor,
            drawBorder: false,
          },
        },
        y: {
          title: {
            display: true,
            text:    'Cantidad producida',
            color:   textMuted,
            font:    { family: fontDisplay, size: 11, weight: '600' },
          },
          ticks: {
            color:    textMuted,
            callback: v => new Intl.NumberFormat('es-DO').format(v),
          },
          grid: {
            color:    borderColor,
            drawBorder: false,
          },
          beginAtZero: true,
        },
      },
    },
  });
}

// ─── Scoped CSS ───────────────────────────────────────────────────────────────

/**
 * Returns a <style> block scoped to #dashboard-module.
 * Injected inline so the module is fully self-contained.
 * Uses only CSS variables already defined in styles.css.
 */
function buildDashboardStyles() {
  return `
    <style id="dashboard-styles">
      /* ── Month selector in header ────────────────────────────── */
      .dashboard-month-label {
        display:        flex;
        flex-direction: column;
        align-items:    flex-end;
        gap:            4px;
        font-family:    var(--font-display);
        font-size:      0.68rem;
        font-weight:    600;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color:          var(--color-text-muted);
        cursor:         default;
        user-select:    none;
      }

      #dashboard-month-selector {
        background:    var(--color-bg-card);
        border:        1px solid var(--color-border);
        border-radius: var(--radius-md, 6px);
        color:         var(--color-text-primary);
        font-family:   var(--font-mono);
        font-size:     0.88rem;
        padding:       5px 10px;
        cursor:        pointer;
        transition:    border-color 0.15s, box-shadow 0.15s;
        outline:       none;
      }

      #dashboard-month-selector:hover {
        border-color: var(--color-accent-border);
      }

      #dashboard-month-selector:focus {
        border-color: var(--color-accent);
        box-shadow:   0 0 0 2px var(--color-accent-glow);
      }

      /* Normalize the native calendar-picker icon colour in Chromium */
      #dashboard-month-selector::-webkit-calendar-picker-indicator {
        filter:  invert(0.6);
        cursor:  pointer;
      }

      /* ── KPI row layout ─────────────────────────────────────── */
      .dashboard-kpi-row {
        display:   grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap:       1px;                       /* hairline dividers */
        background: var(--color-border);      /* gap color = border */
      }

      /* ── Individual KPI card ─────────────────────────────────── */
      .dashboard-kpi-card {
        display:        flex;
        flex-direction: column;
        align-items:    center;
        gap:            var(--space-xs);
        padding:        var(--space-xl) var(--space-lg);
        background:     var(--color-bg-card);
        text-align:     center;
        transition:     background 0.15s;
      }

      .dashboard-kpi-card:hover {
        background: var(--color-bg-hover);
      }

      .dashboard-kpi-card__icon {
        font-size:  1.5rem;
        color:      var(--color-accent);
        line-height: 1;
        filter:     drop-shadow(0 0 6px var(--color-accent));
        margin-bottom: 2px;
      }

      .dashboard-kpi-card__label {
        font-family:    var(--font-display);
        font-size:      0.72rem;
        font-weight:    600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color:          var(--color-text-muted);
      }

      .dashboard-kpi-card__value {
        font-family:    var(--font-display);
        font-size:      1.9rem;
        font-weight:    700;
        color:          var(--color-text-primary);
        letter-spacing: 0.02em;
        line-height:    1.1;
        min-height:     2.2rem;  /* holds space while loading */
      }

      /* Currency values are slightly smaller to keep one line */
      .dashboard-kpi-card__value:has-text(RD\\$) {
        font-size: 1.5rem;
      }

      .dashboard-kpi-card__sub {
        font-size:  0.72rem;
        color:      var(--color-text-muted);
        letter-spacing: 0.04em;
      }

      /* Highlight cards (operator / machine) */
      .dashboard-kpi-card--highlight .dashboard-kpi-card__value {
        font-size:   1.25rem;
        color:       var(--color-accent);
        word-break:  break-word;
        line-height: 1.3;
      }

      /* Spinner placeholder while loading */
      .kpi-loading {
        display:     flex;
        align-items: center;
        justify-content: center;
        height:      2.2rem;
      }

      /* ── Chart container ─────────────────────────────────────── */
      .dashboard-chart-wrap {
        padding:  var(--space-lg);
        height:   320px;        /* fixed height so canvas is not 0px tall */
        position: relative;     /* Chart.js needs a positioned parent      */
      }

      /* ── Cost-per-package breakdown sub-section ──────────────── */
      .dashboard-cost-breakdown {
        width:          100%;
        margin-top:     var(--space-sm);
        padding-top:    var(--space-sm);
        border-top:     1px solid var(--color-border);
        display:        flex;
        flex-direction: column;
        gap:            4px;
      }

      .dashboard-cost-breakdown__row {
        display:         flex;
        justify-content: space-between;
        align-items:     baseline;
        font-size:       0.72rem;
        color:           var(--color-text-muted);
        letter-spacing:  0.02em;
        gap:             var(--space-sm);
      }

      .dashboard-cost-breakdown__row span:first-child {
        white-space: nowrap;
      }

      .dashboard-cost-breakdown__row span:last-child {
        font-family: var(--font-mono);
        font-size:   0.75rem;
        color:       var(--color-text-secondary);
        text-align:  right;
        white-space: nowrap;
      }
    </style>
  `;
}