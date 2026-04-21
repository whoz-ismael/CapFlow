/**
 * payroll.js — CapFlow Nómina (Payroll) Module
 *
 * Quincenal payroll: two pay periods per month.
 *   Q1 = days 01-15  |  Q2 = days 16-end-of-month
 *
 * Per-period stores (localStorage, internal to this module):
 *   capflow_payroll_config       — pay-scheme config per person per month
 *   capflow_payroll_adjustments  — bonus/deduction items per person per periodKey
 *
 * Data flow:
 *   • loadAll() fires one Promise.all for all APIs + PayrollAPI.getByPeriod
 *   • computePay() filters production by [periodStart, periodEnd]
 *   • baseMonthlySalary is always halved (50/50 quincenal split)
 *   • Close: snapshot → upsertByPeriod → LoansAPI.addPayment per installment
 *   • Reopen: LoansAPI.revertPaymentsByReference → removeByPeriod
 *
 * All visible text: Spanish  |  All code identifiers: English
 */

import { OperatorsAPI }  from '../api.js';
import { EmployeesAPI }  from '../api.js';
import { ProductionAPI } from '../api.js';
import { LoansAPI }      from '../api.js';
import { PayrollAPI }    from '../api.js';

// ─── Period helpers ───────────────────────────────────────────────────────────

/** Zero-pad YYYY-MM. */
function normalizeMonth(m) {
  if (!m) return '';
  const [y, mo] = String(m).split('-');
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/** "YYYY-MM-Q1" | "YYYY-MM-Q2" */
function periodKey(month, period) {
  return `${normalizeMonth(month)}-Q${period === 1 ? 1 : 2}`;
}

/**
 * Inclusive ISO date range for a pay period.
 * Q1 → [YYYY-MM-01, YYYY-MM-15]
 * Q2 → [YYYY-MM-16, YYYY-MM-<lastDay>]
 * Uses string comparison (ISO lexicographic) — same approach as other modules.
 */
function periodDateRange(month, period) {
  const nm = normalizeMonth(month);
  if (period === 1) {
    return { start: `${nm}-01`, end: `${nm}-15` };
  }
  // Last day of month via Date
  const [y, mo] = nm.split('-').map(Number);
  const last    = new Date(y, mo, 0).getDate();   // day 0 of next month = last day of this
  return { start: `${nm}-16`, end: `${nm}-${String(last).padStart(2, '0')}` };
}

/** Human-readable label: "1–15 ene 2025" */
function periodLabel(month, period) {
  const nm      = normalizeMonth(month);
  const range   = periodDateRange(nm, period);
  const [y, mo] = nm.split('-').map(Number);
  const mNames  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const mName   = mNames[mo - 1] || '';
  const [, startD] = range.start.split('-');
  const [, ,endD ] = range.end.split('-');
  return `${Number(startD)}–${Number(endD)} ${mName} ${y}`;
}

// ─── Module-level localStorage helpers (config) ───────────────────────────────

const STORAGE_CONFIG = 'capflow_payroll_config';

function readAllConfigs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_CONFIG)) || []; }
  catch { return []; }
}
function readConfig(month) {
  const nm = normalizeMonth(month);
  return readAllConfigs().find(c => c.month === nm) || { month: nm, items: [] };
}
function writeConfig(month, items) {
  const nm  = normalizeMonth(month);
  const all = readAllConfigs().filter(c => c.month !== nm);
  all.push({ month: nm, items });
  localStorage.setItem(STORAGE_CONFIG, JSON.stringify(all));
}
function getPersonConfig(month, pKey) {
  return readConfig(month).items.find(i => i.personKey === pKey) || null;
}
function setPersonConfig(month, pKey, patch) {
  const config = readConfig(month);
  const idx    = config.items.findIndex(i => i.personKey === pKey);
  if (idx === -1) {
    config.items.push({ personKey: pKey, payScheme: 'production_only', baseMonthlySalary: 0, ...patch });
  } else {
    config.items[idx] = { ...config.items[idx], ...patch };
  }
  writeConfig(month, config.items);
}

// ─── Module-level localStorage helpers (adjustments) ─────────────────────────
// Adjustments are per-person per-periodKey (bonuses/deductions differ each quincena).

const STORAGE_ADJ = 'capflow_payroll_adjustments';

function readAllAdjs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_ADJ)) || []; }
  catch { return []; }
}
function readAdj(pk) {
  return readAllAdjs().find(a => a.periodKey === pk) || { periodKey: pk, items: [] };
}
function writeAdj(pk, items) {
  const all = readAllAdjs().filter(a => a.periodKey !== pk);
  all.push({ periodKey: pk, items });
  localStorage.setItem(STORAGE_ADJ, JSON.stringify(all));
}
function getPersonAdjs(pk, pKey) {
  return readAdj(pk).items.filter(i => i.personKey === pKey);
}
function addAdj(pk, pKey, { type, amount, note }) {
  const adj = readAdj(pk);
  adj.items.push({
    id:        `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    personKey: pKey, type,
    amount:    Number(amount) || 0,
    note:      (note || '').trim(),
    createdAt: new Date().toISOString(),
  });
  writeAdj(pk, adj.items);
}
function removeAdj(pk, adjId) {
  const adj = readAdj(pk);
  writeAdj(pk, adj.items.filter(i => i.id !== adjId));
}

// ─── Module State ─────────────────────────────────────────────────────────────

let selectedMonth  = normalizeMonth(new Date().toISOString().slice(0, 7));
let selectedPeriod = 1;                // 1 or 2
let allOperators   = [];
let allEmployees   = [];
let allProduction  = [];
let allLoans       = [];
let payrollRun     = null;

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function mountPayroll(container) {
  container.innerHTML = buildShellHTML();
  injectStyles();
  attachTopListeners();
  await loadAll();
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────

function buildShellHTML() {
  return `
  <section class="module" id="payroll-module">

    <header class="module-header">
      <div class="module-header__left">
        <span class="module-header__icon">◎</span>
        <div>
          <h1 class="module-header__title">Nómina</h1>
          <p class="module-header__subtitle">Pagos quincenales — Q1: días 1–15 · Q2: días 16–fin de mes</p>
        </div>
      </div>
      <div class="module-header__badge" id="payroll-status-badge">—</div>
    </header>

    <!-- Month + period selector bar -->
    <div class="card payroll-topbar">
      <div class="payroll-topbar__left">
        <div class="form-group" style="margin:0;">
          <label class="form-label" for="payroll-month">Mes</label>
          <input class="form-input" type="month" id="payroll-month" value="${selectedMonth}">
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Quincena</label>
          <div class="payroll-period-btns" id="payroll-period-btns">
            <button class="payroll-period-btn payroll-period-btn--active" data-period="1">
              Q1 <small id="payroll-q1-label"></small>
            </button>
            <button class="payroll-period-btn" data-period="2">
              Q2 <small id="payroll-q2-label"></small>
            </button>
          </div>
        </div>
        <div id="payroll-period-hint" class="payroll-period-hint"></div>
      </div>
      <div id="payroll-action-area"></div>
    </div>

    <!-- Tabs -->
    <div class="payroll-tabs" id="payroll-tabs">
      <button class="payroll-tab payroll-tab--active" data-tab="operators">◈ Operarios</button>
      <button class="payroll-tab" data-tab="employees">◉ Empleados fijos</button>
    </div>

    <!-- Tab panels -->
    <div id="payroll-tab-operators" class="payroll-tab-panel">
      <div class="payroll-loading" id="payroll-loading">
        <div class="spinner"></div><span>Cargando nómina…</span>
      </div>
      <div id="payroll-operators-content" style="display:none;"></div>
    </div>

    <div id="payroll-tab-employees" class="payroll-tab-panel" style="display:none;">
      <div id="payroll-employees-content"></div>
    </div>

  </section>
  `;
}

// ─── Top-level listeners ──────────────────────────────────────────────────────

function attachTopListeners() {
  document.getElementById('payroll-month').addEventListener('change', async e => {
    selectedMonth = normalizeMonth(e.target.value);
    updatePeriodLabels();
    await loadAll();
  });

  document.getElementById('payroll-period-btns').addEventListener('click', async e => {
    const btn = e.target.closest('.payroll-period-btn');
    if (!btn) return;
    const p = Number(btn.dataset.period);
    if (p === selectedPeriod) return;
    selectedPeriod = p;
    document.querySelectorAll('.payroll-period-btn').forEach(b =>
      b.classList.toggle('payroll-period-btn--active', Number(b.dataset.period) === selectedPeriod)
    );
    await loadAll();
  });

  document.getElementById('payroll-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.payroll-tab');
    if (!btn) return;
    document.querySelectorAll('.payroll-tab').forEach(b => b.classList.remove('payroll-tab--active'));
    btn.classList.add('payroll-tab--active');
    document.querySelectorAll('.payroll-tab-panel').forEach(p => (p.style.display = 'none'));
    document.getElementById(`payroll-tab-${btn.dataset.tab}`).style.display = 'block';
  });

  updatePeriodLabels();
}

function updatePeriodLabels() {
  const nm = normalizeMonth(selectedMonth);
  const hint = document.getElementById('payroll-period-hint');
  if (hint) hint.textContent = periodLabel(nm, selectedPeriod);
  // Also update small labels inside buttons
  const q1 = document.getElementById('payroll-q1-label');
  const q2 = document.getElementById('payroll-q2-label');
  if (q1) { const r = periodDateRange(nm, 1); q1.textContent = `(${r.start.slice(8)}–${r.end.slice(8)})`; }
  if (q2) { const r = periodDateRange(nm, 2); q2.textContent = `(${r.start.slice(8)}–${r.end.slice(8)})`; }
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadAll() {
  showLoading(true);
  try {
    [allOperators, allEmployees, allProduction, allLoans, payrollRun] = await Promise.all([
      OperatorsAPI.getAll(),
      EmployeesAPI.getAll(),
      ProductionAPI.getAll(),
      LoansAPI.getAll(),
      PayrollAPI.getByPeriod(selectedMonth, selectedPeriod),
    ]);
    renderAll();
  } catch (err) {
    showFeedback(`Error al cargar nómina: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

function showLoading(on) {
  const el = document.getElementById('payroll-loading');
  if (el) el.style.display = on ? 'flex' : 'none';
}

// ─── Master Render ────────────────────────────────────────────────────────────

function renderAll() {
  const isClosed = payrollRun?.isClosed === true;
  const pk       = periodKey(selectedMonth, selectedPeriod);
  const label    = periodLabel(selectedMonth, selectedPeriod);

  updatePeriodLabels();

  // Status badge
  const badge = document.getElementById('payroll-status-badge');
  if (badge) {
    badge.textContent = isClosed ? '🔒 CERRADA' : '🟢 ABIERTA';
    badge.className   = 'module-header__badge payroll-status-badge--' + (isClosed ? 'closed' : 'open');
  }

  // Action area
  const area = document.getElementById('payroll-action-area');
  if (area) {
    if (isClosed) {
      area.innerHTML = `<button class="btn btn--ghost btn--sm" id="payroll-reopen-btn">↩ Reabrir quincena</button>`;
      area.querySelector('#payroll-reopen-btn').addEventListener('click', handleReopenPeriod);
    } else {
      area.innerHTML = `<button class="btn btn--primary btn--sm" id="payroll-close-btn">🔒 Cerrar quincena</button>`;
      area.querySelector('#payroll-close-btn').addEventListener('click', handleClosePeriod);
    }
  }

  renderOperatorsTab(isClosed, pk);
  renderEmployeesTab(isClosed, pk);
}

// ─── Pay Computation ─────────────────────────────────────────────────────────

/**
 * Compute pay for one person for the currently selected month + period.
 *
 * Production pay uses only records within [periodStart, periodEnd].
 * Base salary is always halved (50/50 quincenal split).
 *
 * @param {string}           personKey
 * @param {'operator'|'employee'} personType
 * @param {string}           personId
 * @param {string}           personName
 * @param {number}           defaultMonthlySalary  — full monthly amount
 * @param {string}           defaultScheme
 * @param {string}           pk  — current periodKey
 * @returns {Object}
 */
function computePay(personKey, personType, personId, personName,
                    defaultMonthlySalary, defaultScheme, pk) {
  const cfg            = getPersonConfig(selectedMonth, personKey);
  const payScheme      = cfg?.payScheme         ?? defaultScheme;
  const monthlySalary  = cfg?.baseMonthlySalary ?? defaultMonthlySalary;
  // Per-period base = half the monthly salary (50/50 quincenal)
  const basePeriodSalary = (monthlySalary || 0) / 2;

  // Production pay: only records inside the period date range
  const range = periodDateRange(selectedMonth, selectedPeriod);
  const periodProd = allProduction.filter(r =>
    String(r.operatorId) === String(personId) &&
    (r.productionDate || '') >= range.start &&
    (r.productionDate || '') <= range.end
  );
  const productionPackages = periodProd.reduce((s, r) => s + (r.quantity || 0), 0);
  const productionPay      = periodProd.reduce(
    (s, r) => s + (r.quantity || 0) * (r.operatorRateSnapshot || 0), 0
  );

  // Gross
  let gross = 0;
  if      (payScheme === 'production_only')       gross = productionPay;
  else if (payScheme === 'salary_only')           gross = basePeriodSalary;
  else if (payScheme === 'salary_plus_incentive') gross = basePeriodSalary + productionPay;

  // Adjustments (period-scoped)
  const adjs           = getPersonAdjs(pk, personKey);
  const bonusesTotal   = adjs.filter(a => a.type === 'bonus'    ).reduce((s, a) => s + a.amount, 0);
  const deductionsTotal= adjs.filter(a => a.type === 'deduction').reduce((s, a) => s + a.amount, 0);

  // Loan deductions — one installment per period, capped so net ≥ 0
  const personLoans = allLoans.filter(l =>
    l.personKey === personKey && l.isActive && l.remaining > 0 &&
    normalizeMonth(l.startMonth) <= normalizeMonth(selectedMonth)
  );

  let loanDeductionTotal = 0;
  const loanBreakdown    = [];
  let runningAvailable   = Math.max(0, gross + bonusesTotal - deductionsTotal);

  for (const loan of personLoans) {
    const pay = Math.min(loan.installment, loan.remaining, Math.max(0, runningAvailable));
    if (pay > 0) {
      loanBreakdown.push({ loanId: loan.id, amount: pay });
      loanDeductionTotal += pay;
      runningAvailable   -= pay;
    }
  }

  const netPay = gross + bonusesTotal - deductionsTotal - loanDeductionTotal;

  return {
    personKey, personType, personId, nameSnapshot: personName,
    payScheme, baseMonthlySalary: monthlySalary, basePeriodSalary,
    productionPackages, productionPay,
    bonusesTotal, deductionsTotal, loanDeductionTotal,
    gross, netPay,
    loanBreakdown,
  };
}

// ─── Operators Tab ────────────────────────────────────────────────────────────

function renderOperatorsTab(isClosed, pk) {
  const container = document.getElementById('payroll-operators-content');
  if (!container) return;
  container.style.display = 'block';

  let rows;
  if (isClosed && payrollRun?.rows) {
    rows = payrollRun.rows.filter(r => r.personType === 'operator');
  } else {
    rows = allOperators.filter(o => o.isActive !== false).map(op =>
      computePay(`operator:${op.id}`, 'operator', op.id, op.name, 0, 'production_only', pk)
    );
  }

  if (!rows.length) {
    container.innerHTML = `<div class="card"><div class="table-empty" style="display:flex;">
      <span class="table-empty__icon">◈</span><p>No hay operarios activos.</p></div></div>`;
    return;
  }

  const actionTh = isClosed ? '' : '<th class="text-center">Acciones</th>';
  container.innerHTML = `
    <div class="card" style="overflow-x:auto;">
      <table class="data-table payroll-table">
        <thead><tr>
          <th>Operario</th>
          <th class="text-right">Paquetes</th>
          <th class="text-right">Pago prod.</th>
          <th class="text-right">Bonos</th>
          <th class="text-right">Deduc.</th>
          <th class="text-right">Préstamo</th>
          <th class="text-right">Neto</th>
          ${actionTh}
        </tr></thead>
        <tbody>${rows.map(r => buildPayrollRow(r, isClosed, 'production_only')).join('')}</tbody>
      </table>
    </div>`;

  if (!isClosed) attachRowActionListeners(container, pk);
}

// ─── Employees Tab ────────────────────────────────────────────────────────────

function renderEmployeesTab(isClosed, pk) {
  const container = document.getElementById('payroll-employees-content');
  if (!container) return;

  let rows;
  if (isClosed && payrollRun?.rows) {
    rows = payrollRun.rows.filter(r => r.personType === 'employee');
  } else {
    rows = allEmployees.filter(e => e.isActive !== false).map(emp =>
      computePay(`employee:${emp.id}`, 'employee', emp.id, emp.name,
        emp.monthlySalary || 0, 'salary_only', pk)
    );
  }

  const actionTh = isClosed ? '' : '<th class="text-center">Acciones</th>';
  const payrollTableHTML = rows.length === 0
    ? `<div class="table-empty" style="display:flex;"><span class="table-empty__icon">◉</span>
       <p>No hay empleados fijos activos.</p></div>`
    : `<table class="data-table payroll-table">
        <thead><tr>
          <th>Empleado</th>
          <th class="text-right">Base quincenal</th>
          <th class="text-right">Bonos</th>
          <th class="text-right">Deduc.</th>
          <th class="text-right">Préstamo</th>
          <th class="text-right">Neto</th>
          ${actionTh}
        </tr></thead>
        <tbody>${rows.map(r => buildPayrollRow(r, isClosed, 'salary_only')).join('')}</tbody>
       </table>`;

  container.innerHTML = `
    <div class="card" style="overflow-x:auto;margin-bottom:var(--space-lg);">
      <div class="card__header">
        <span class="card__title">Empleados fijos</span>
        ${isClosed ? '' : `<button class="btn btn--primary btn--sm" id="payroll-add-emp-btn">+ Nuevo</button>`}
      </div>
      ${payrollTableHTML}
    </div>
    <div class="card">
      <div class="card__header">
        <span class="card__title">Gestión de empleados</span>
        <button class="btn btn--primary btn--sm" id="payroll-manage-emp-btn">+ Nuevo empleado</button>
      </div>
      ${buildEmployeesManagementTable()}
    </div>`;

  if (!isClosed) attachRowActionListeners(container, pk);
  attachEmployeeManagementListeners(container);
}

function buildEmployeesManagementTable() {
  if (!allEmployees.length) {
    return '<p style="padding:var(--space-md);color:var(--color-text-muted);">Sin empleados registrados.</p>';
  }
  return `<div style="overflow-x:auto;"><table class="data-table">
    <thead><tr>
      <th>Nombre</th><th>Puesto</th>
      <th class="text-right">Salario mensual</th>
      <th class="text-center">Estado</th>
      <th class="text-center">Acciones</th>
    </tr></thead>
    <tbody>${allEmployees.map(emp => {
      const isActive = emp.isActive !== false;
      return `<tr class="table-row">
        <td>${escapeHTML(emp.name)}</td>
        <td>${escapeHTML(emp.position || '—')}</td>
        <td class="text-right">${fmtCurrency(emp.monthlySalary || 0)}</td>
        <td class="text-center">
          <span class="badge ${isActive ? 'badge--green' : 'badge--gray'}">
            ${isActive ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="text-center td-actions">
          <button class="btn btn--ghost btn--xs" data-action="edit-employee" data-id="${emp.id}">✎ Editar</button>
          <button class="btn btn--${isActive ? 'danger' : 'ghost'} btn--xs"
            data-action="toggle-employee" data-id="${emp.id}" data-active="${isActive}">
            ${isActive ? '⊘ Desactivar' : '✔ Activar'}
          </button>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

// ─── Row builder ──────────────────────────────────────────────────────────────

function buildPayrollRow(row, isClosed, defaultScheme) {
  const scheme      = row.payScheme || defaultScheme;
  const schemeLabel = { production_only: 'Producción', salary_only: 'Salario fijo',
    salary_plus_incentive: 'Salario + incentivo' }[scheme] || scheme;

  const actions = isClosed ? '' : `
    <td class="text-center td-actions" style="white-space:nowrap;">
      <button class="btn btn--ghost btn--xs payroll-action" data-action="config"
        data-key="${escapeHTML(row.personKey)}" title="Esquema de pago">⚙</button>
      <button class="btn btn--ghost btn--xs payroll-action" data-action="adjustments"
        data-key="${escapeHTML(row.personKey)}" title="Bonos / descuentos">±</button>
      <button class="btn btn--ghost btn--xs payroll-action" data-action="loans"
        data-key="${escapeHTML(row.personKey)}" title="Préstamos">🏦</button>
    </td>`;

  const netCls = row.netPay >= 0 ? 'inv-qty-positive' : 'inv-qty-negative';

  return `<tr class="table-row">
    <td>
      <div style="font-weight:600;">${escapeHTML(row.nameSnapshot)}</div>
      <div style="font-size:0.75rem;color:var(--color-text-muted);">${schemeLabel}</div>
    </td>
    ${row.personType === 'operator'
      ? `<td class="text-right">${fmtNum(row.productionPackages)}</td>
         <td class="text-right">${fmtCurrency(row.productionPay)}</td>`
      : `<td class="text-right" colspan="2">${fmtCurrency(row.basePeriodSalary ?? (row.baseMonthlySalary || 0) / 2)}</td>`}
    <td class="text-right" style="color:var(--color-success);">
      ${row.bonusesTotal > 0 ? '+' + fmtCurrency(row.bonusesTotal) : '—'}</td>
    <td class="text-right" style="color:var(--color-danger);">
      ${row.deductionsTotal > 0 ? '-' + fmtCurrency(row.deductionsTotal) : '—'}</td>
    <td class="text-right" style="color:var(--color-danger);">
      ${row.loanDeductionTotal > 0 ? '-' + fmtCurrency(row.loanDeductionTotal) : '—'}</td>
    <td class="text-right"><strong class="${netCls}">${fmtCurrency(row.netPay)}</strong></td>
    ${actions}
  </tr>`;
}

function attachRowActionListeners(container, pk) {
  container.querySelectorAll('.payroll-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, key } = btn.dataset;
      if      (action === 'config')      openConfigModal(key);
      else if (action === 'adjustments') openAdjustmentsModal(key, pk);
      else if (action === 'loans')       openLoansModal(key);
    });
  });
}

// ─── Close Period ─────────────────────────────────────────────────────────────

async function handleClosePeriod() {
  const label = periodLabel(selectedMonth, selectedPeriod);
  if (!confirm(`¿Cerrar la nómina de ${label}?\n\nEsto registrará los pagos de préstamos y bloqueará la edición.`)) return;

  const btn = document.getElementById('payroll-close-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cerrando…'; }

  const pk = periodKey(selectedMonth, selectedPeriod);

  try {
    const opRows  = allOperators.filter(o => o.isActive !== false).map(op =>
      computePay(`operator:${op.id}`, 'operator', op.id, op.name, 0, 'production_only', pk));
    const empRows = allEmployees.filter(e => e.isActive !== false).map(emp =>
      computePay(`employee:${emp.id}`, 'employee', emp.id, emp.name,
        emp.monthlySalary || 0, 'salary_only', pk));
    const allRows = [...opRows, ...empRows];

    const totals = {
      gross:      allRows.reduce((s, r) => s + r.gross, 0),
      bonuses:    allRows.reduce((s, r) => s + r.bonusesTotal, 0),
      deductions: allRows.reduce((s, r) => s + r.deductionsTotal, 0),
      loans:      allRows.reduce((s, r) => s + r.loanDeductionTotal, 0),
      net:        allRows.reduce((s, r) => s + r.netPay, 0),
    };

    // Step 1: upsert to get a stable id
    const saved = await PayrollAPI.upsertByPeriod(selectedMonth, selectedPeriod, {
      isClosed: true, closedAt: new Date().toISOString(),
      loanReferenceId: null, totals, rows: allRows,
    });

    const loanReferenceId = `payroll:${saved.id}`;

    // Step 2: write loanReferenceId back
    await PayrollAPI.upsertByPeriod(selectedMonth, selectedPeriod, {
      isClosed: true, closedAt: saved.closedAt,
      loanReferenceId, totals, rows: allRows,
    });

    // Step 3: apply loan payments
    for (const row of allRows) {
      for (const lb of (row.loanBreakdown || [])) {
        if (lb.amount > 0) {
          await LoansAPI.addPayment(lb.loanId, {
            month: selectedMonth, amount: lb.amount,
            referenceId: loanReferenceId,
            note: `Nómina ${pk}`,
          });
        }
      }
    }

    showFeedback(`Nómina ${label} cerrada correctamente.`, 'success');
    await loadAll();
  } catch (err) {
    showFeedback(`Error al cerrar: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Cerrar quincena'; }
  }
}

// ─── Reopen Period ────────────────────────────────────────────────────────────

async function handleReopenPeriod() {
  const label = periodLabel(selectedMonth, selectedPeriod);
  if (!confirm(`¿Reabrir la nómina de ${label}?\n\nEsto revertirá los pagos de préstamos registrados.`)) return;

  const btn = document.getElementById('payroll-reopen-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Reabriendo…'; }

  try {
    const loanReferenceId = payrollRun?.loanReferenceId;
    if (loanReferenceId) {
      await LoansAPI.revertPaymentsByReference(loanReferenceId);
    }
    await PayrollAPI.removeByPeriod(selectedMonth, selectedPeriod);
    showFeedback(`Nómina ${label} reabierta.`, 'info');
    await loadAll();
  } catch (err) {
    showFeedback(`Error al reabrir: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '↩ Reabrir quincena'; }
  }
}

// ─── Config Modal ─────────────────────────────────────────────────────────────

function openConfigModal(pKey) {
  const cfg  = getPersonConfig(selectedMonth, pKey) || { payScheme: 'production_only', baseMonthlySalary: 0 };
  const name = personDisplayName(pKey);

  const modal = buildModal(`Configurar — ${name}`, `
    <div class="form-grid">
      <div class="form-group form-group--wide">
        <label class="form-label">Esquema de pago</label>
        <div class="select-wrapper"><select class="form-input form-select" id="cfg-scheme">
          <option value="production_only"       ${cfg.payScheme==='production_only'       ? 'selected':''}>Solo producción</option>
          <option value="salary_only"           ${cfg.payScheme==='salary_only'           ? 'selected':''}>Salario fijo</option>
          <option value="salary_plus_incentive" ${cfg.payScheme==='salary_plus_incentive' ? 'selected':''}>Salario + incentivo</option>
        </select></div>
      </div>
      <div class="form-group form-group--wide">
        <label class="form-label">Salario base mensual (RD$)</label>
        <input class="form-input" type="number" id="cfg-salary" min="0" step="0.01"
          value="${cfg.baseMonthlySalary || 0}">
        <span class="form-hint">Base mensual — se divide entre 2 por quincena automáticamente.</span>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn--primary" id="cfg-save-btn">Guardar</button>
    </div>`);

  modal.querySelector('#cfg-save-btn').addEventListener('click', () => {
    setPersonConfig(selectedMonth, pKey, {
      payScheme:         modal.querySelector('#cfg-scheme').value,
      baseMonthlySalary: parseFloat(modal.querySelector('#cfg-salary').value) || 0,
    });
    closeModal(modal);
    renderAll();
  });
  openModal(modal);
}

// ─── Adjustments Modal ────────────────────────────────────────────────────────

function openAdjustmentsModal(pKey, pk) {
  const name = personDisplayName(pKey);

  const buildBody = () => {
    const adjs = getPersonAdjs(pk, pKey);
    const list = adjs.length === 0
      ? '<p style="color:var(--color-text-muted);padding:var(--space-sm) 0;">Sin ajustes para esta quincena.</p>'
      : adjs.map(a => `
        <div class="adj-row">
          <span class="adj-type ${a.type==='bonus' ? 'adj-bonus' : 'adj-deduction'}">
            ${a.type === 'bonus' ? '+ Bono' : '- Descuento'}
          </span>
          <span class="adj-amount">${fmtCurrency(a.amount)}</span>
          <span class="adj-note">${escapeHTML(a.note || '—')}</span>
          <button class="btn btn--danger btn--xs adj-remove" data-id="${a.id}">✕</button>
        </div>`).join('');

    return `
      <div id="adj-list">${list}</div>
      <hr style="border:none;border-top:1px solid var(--color-border);margin:var(--space-md) 0;">
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Tipo</label>
          <div class="select-wrapper"><select class="form-input form-select" id="adj-type">
            <option value="bonus">Bono</option>
            <option value="deduction">Descuento</option>
          </select></div>
        </div>
        <div class="form-group">
          <label class="form-label">Monto (RD$)</label>
          <input class="form-input" type="number" id="adj-amount" min="0.01" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group form-group--wide">
          <label class="form-label">Nota (opcional)</label>
          <input class="form-input" type="text" id="adj-note" maxlength="100" placeholder="Descripción…">
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn--primary" id="adj-add-btn">Agregar ajuste</button>
      </div>`;
  };

  const modal = buildModal(`Ajustes — ${name}`, buildBody());

  const rewire = () => {
    modal.querySelector('#adj-add-btn').addEventListener('click', () => {
      const type   = modal.querySelector('#adj-type').value;
      const amount = parseFloat(modal.querySelector('#adj-amount').value);
      const note   = modal.querySelector('#adj-note').value;
      if (!amount || amount <= 0) { showFeedback('Monto inválido.', 'error'); return; }
      addAdj(pk, pKey, { type, amount, note });
      modal.querySelector('.pr-modal__body').innerHTML = buildBody();
      rewire();
      renderAll();
    });
    modal.querySelectorAll('.adj-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        removeAdj(pk, btn.dataset.id);
        modal.querySelector('.pr-modal__body').innerHTML = buildBody();
        rewire();
        renderAll();
      });
    });
  };
  rewire();
  openModal(modal);
}

// ─── Loans Modal ──────────────────────────────────────────────────────────────

function openLoansModal(pKey) {
  const name = personDisplayName(pKey);

  const buildBody = () => {
    const loans = allLoans.filter(l => l.personKey === pKey);
    const list  = loans.length === 0
      ? '<p style="color:var(--color-text-muted);padding:var(--space-sm) 0;">Sin préstamos.</p>'
      : loans.map(l => `
        <div class="loan-row">
          <div class="loan-row__info">
            <strong>${fmtCurrency(l.principal)}</strong>
            <span style="font-size:0.8rem;color:var(--color-text-muted);">
              Cuota: ${fmtCurrency(l.installment)} · Resta: ${fmtCurrency(l.remaining)} · Desde: ${l.startMonth}
            </span>
            <span class="badge ${l.isActive ? 'badge--green' : 'badge--gray'}">
              ${l.isActive ? 'Activo' : 'Inactivo'}</span>
          </div>
          <div class="loan-row__actions">
            <button class="btn btn--${l.isActive ? 'danger' : 'ghost'} btn--xs loan-toggle"
              data-id="${l.id}" data-active="${l.isActive}">
              ${l.isActive ? '⊘ Desactivar' : '✔ Activar'}
            </button>
          </div>
        </div>`).join('');

    return `
      <div id="loan-list">${list}</div>
      <hr style="border:none;border-top:1px solid var(--color-border);margin:var(--space-md) 0;">
      <p class="form-label" style="margin-bottom:var(--space-sm);">Nuevo préstamo</p>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Capital (RD$)</label>
          <input class="form-input" type="number" id="loan-principal" min="1" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Cuota mensual (RD$)</label>
          <input class="form-input" type="number" id="loan-installment" min="1" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="form-label">Mes inicio</label>
          <input class="form-input" type="month" id="loan-startmonth" value="${selectedMonth}">
        </div>
        <div class="form-group form-group--wide">
          <label class="form-label">Nota (opcional)</label>
          <input class="form-input" type="text" id="loan-note" maxlength="100">
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn--primary" id="loan-create-btn">Crear préstamo</button>
      </div>`;
  };

  const modal = buildModal(`Préstamos — ${name}`, buildBody());

  const rewire = async () => {
    modal.querySelector('#loan-create-btn').addEventListener('click', async () => {
      const principal   = parseFloat(modal.querySelector('#loan-principal').value);
      const installment = parseFloat(modal.querySelector('#loan-installment').value);
      const startMonth  = modal.querySelector('#loan-startmonth').value;
      const note        = modal.querySelector('#loan-note').value;
      if (!principal   || principal   <= 0) { showFeedback('Capital inválido.', 'error'); return; }
      if (!installment || installment <= 0) { showFeedback('Cuota inválida.',   'error'); return; }
      try {
        await LoansAPI.create({ personKey: pKey, principal, installment, startMonth, note });
        allLoans = await LoansAPI.getAll();
        modal.querySelector('.pr-modal__body').innerHTML = buildBody();
        await rewire();
        renderAll();
      } catch (err) { showFeedback(`Error: ${err.message}`, 'error'); }
    });

    modal.querySelectorAll('.loan-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const active = btn.dataset.active === 'true';
        try {
          if (active) await LoansAPI.deactivate(btn.dataset.id);
          else        await LoansAPI.activate(btn.dataset.id);
          allLoans = await LoansAPI.getAll();
          modal.querySelector('.pr-modal__body').innerHTML = buildBody();
          await rewire();
          renderAll();
        } catch (err) { showFeedback(`Error: ${err.message}`, 'error'); }
      });
    });
  };
  rewire();
  openModal(modal);
}

// ─── Employee Management ──────────────────────────────────────────────────────

function attachEmployeeManagementListeners(container) {
  container.querySelector('#payroll-manage-emp-btn')?.addEventListener('click', () => openEmployeeModal(null));
  container.querySelector('#payroll-add-emp-btn')?.addEventListener('click',    () => openEmployeeModal(null));

  container.querySelectorAll('[data-action="edit-employee"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const emp = allEmployees.find(e => String(e.id) === String(btn.dataset.id));
      if (emp) openEmployeeModal(emp);
    });
  });

  container.querySelectorAll('[data-action="toggle-employee"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const active = btn.dataset.active === 'true';
      try {
        if (active) await EmployeesAPI.deactivate(btn.dataset.id);
        else        await EmployeesAPI.activate(btn.dataset.id);
        allEmployees = await EmployeesAPI.getAll();
        renderEmployeesTab(payrollRun?.isClosed === true, periodKey(selectedMonth, selectedPeriod));
      } catch (err) { showFeedback(`Error: ${err.message}`, 'error'); }
    });
  });
}

function openEmployeeModal(emp) {
  const isEdit = !!emp;
  const modal  = buildModal(isEdit ? `Editar — ${emp.name}` : 'Nuevo empleado', `
    <div class="form-grid">
      <div class="form-group form-group--wide">
        <label class="form-label">Nombre <span class="required">*</span></label>
        <input class="form-input" type="text" id="emp-name" maxlength="120"
          value="${escapeHTML(emp?.name || '')}" placeholder="Ej: María García">
        <span class="form-error" id="emp-err-name"></span>
      </div>
      <div class="form-group">
        <label class="form-label">Documento / Cédula</label>
        <input class="form-input" type="text" id="emp-doc" maxlength="20"
          value="${escapeHTML(emp?.document || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Teléfono</label>
        <input class="form-input" type="tel" id="emp-phone" maxlength="20"
          value="${escapeHTML(emp?.phone || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" type="email" id="emp-email" maxlength="80"
          value="${escapeHTML(emp?.email || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Puesto</label>
        <input class="form-input" type="text" id="emp-position" maxlength="80"
          value="${escapeHTML(emp?.position || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Salario mensual (RD$) <span class="required">*</span></label>
        <input class="form-input" type="number" id="emp-salary" min="0" step="0.01"
          value="${emp?.monthlySalary ?? ''}" placeholder="0.00">
        <span class="form-error" id="emp-err-salary"></span>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn--primary" id="emp-save-btn">${isEdit ? 'Guardar cambios' : 'Crear empleado'}</button>
    </div>`);

  modal.querySelector('#emp-save-btn').addEventListener('click', async () => {
    const nameVal  = modal.querySelector('#emp-name').value.trim();
    const salaryVal= parseFloat(modal.querySelector('#emp-salary').value);
    modal.querySelector('#emp-err-name').textContent   = '';
    modal.querySelector('#emp-err-salary').textContent = '';
    let valid = true;
    if (!nameVal)                      { modal.querySelector('#emp-err-name').textContent   = 'Requerido.';       valid = false; }
    if (isNaN(salaryVal) || salaryVal < 0) { modal.querySelector('#emp-err-salary').textContent = 'Salario inválido.'; valid = false; }
    if (!valid) return;

    const saveBtn = modal.querySelector('#emp-save-btn');
    setButtonLoading(saveBtn, true);
    try {
      const data = {
        name: nameVal, monthlySalary: salaryVal,
        document: modal.querySelector('#emp-doc').value.trim(),
        phone:    modal.querySelector('#emp-phone').value.trim(),
        email:    modal.querySelector('#emp-email').value.trim(),
        position: modal.querySelector('#emp-position').value.trim(),
      };
      if (isEdit) await EmployeesAPI.update(emp.id, data);
      else        await EmployeesAPI.create(data);
      allEmployees = await EmployeesAPI.getAll();
      closeModal(modal);
      renderAll();
      showFeedback(isEdit ? 'Empleado actualizado.' : 'Empleado creado.', 'success');
    } catch (err) {
      showFeedback(`Error: ${err.message}`, 'error');
      setButtonLoading(saveBtn, false);
    }
  });
  openModal(modal);
}

// ─── Modal system ─────────────────────────────────────────────────────────────

function buildModal(title, bodyHTML) {
  const el = document.createElement('div');
  el.className = 'pr-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="pr-modal__panel">
      <div class="pr-modal__header">
        <h3 class="pr-modal__title">${escapeHTML(title)}</h3>
        <button class="pr-modal__close btn btn--ghost btn--sm" aria-label="Cerrar">✕</button>
      </div>
      <div class="pr-modal__body">${bodyHTML}</div>
    </div>`;
  return el;
}

function openModal(modal) {
  document.body.appendChild(modal);
  const close = () => {
    if (modal.classList.contains('pr-modal--exiting')) return;
    modal.classList.add('pr-modal--exiting');
    modal.addEventListener('animationend', () => modal.remove(), { once: true });
  };
  modal.querySelector('.pr-modal__close').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

function closeModal(modal) {
  if (!modal || modal.classList.contains('pr-modal--exiting')) return;
  modal.classList.add('pr-modal--exiting');
  modal.addEventListener('animationend', () => modal.remove(), { once: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function personDisplayName(pKey) {
  const [type, id] = pKey.split(':');
  if (type === 'operator') {
    const op = allOperators.find(o => String(o.id) === String(id));
    return op ? op.name : pKey;
  }
  if (type === 'employee') {
    const emp = allEmployees.find(e => String(e.id) === String(id));
    return emp ? emp.name : pKey;
  }
  return pKey;
}

function fmtCurrency(n) {
  return 'RD$ ' + new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n || 0);
}
function fmtNum(n) { return new Intl.NumberFormat('es-DO').format(n || 0); }
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
    <span class="toast__icon">${icons[type] ?? 'ℹ'}</span>
    <span class="toast__message">${escapeHTML(message)}</span>
    <span class="toast__close">&times;</span>`;
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

// ─── Styles ───────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('payroll-module-styles')) return;
  const s = document.createElement('style');
  s.id = 'payroll-module-styles';
  s.textContent = `
    /* ── Top bar ── */
    .payroll-topbar {
      display: flex; align-items: flex-end; justify-content: space-between;
      flex-wrap: wrap; gap: var(--space-md);
      padding: var(--space-md) var(--space-lg); margin-bottom: 0;
    }
    .payroll-topbar__left { display: flex; align-items: flex-end; gap: var(--space-lg); flex-wrap: wrap; }

    /* ── Period toggle buttons ── */
    .payroll-period-btns { display: flex; gap: 0; border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow: hidden; }
    .payroll-period-btn  {
      background: var(--color-surface); border: none; cursor: pointer;
      padding: 6px 14px; font-size: 0.85rem; font-weight: 500;
      color: var(--color-text-muted); transition: background .12s, color .12s;
    }
    .payroll-period-btn + .payroll-period-btn { border-left: 1px solid var(--color-border); }
    .payroll-period-btn:hover { background: var(--color-surface-secondary, var(--color-bg-card)); color: var(--color-text); }
    .payroll-period-btn--active {
      background: var(--color-primary, #6c63ff); color: #fff; font-weight: 700;
    }
    .payroll-period-btn small { font-size: 0.72rem; opacity: .8; margin-left: 4px; }

    .payroll-period-hint {
      font-size: 0.82rem; color: var(--color-text-muted);
      align-self: flex-end; padding-bottom: 4px;
    }

    /* ── Status badge variants ── */
    .payroll-status-badge--open   { background: var(--color-success, #38a169) !important; color: #fff !important; }
    .payroll-status-badge--closed { background: var(--color-danger,  #e53e3e) !important; color: #fff !important; }

    /* ── Tabs ── */
    .payroll-tabs {
      display: flex; border-bottom: 2px solid var(--color-border);
      margin-bottom: var(--space-lg);
    }
    .payroll-tab {
      background: none; border: none; cursor: pointer;
      padding: var(--space-sm) var(--space-lg); font-size: 0.9rem; font-weight: 500;
      color: var(--color-text-muted);
      border-bottom: 2px solid transparent; margin-bottom: -2px;
      transition: color .15s, border-color .15s;
    }
    .payroll-tab:hover { color: var(--color-text); }
    .payroll-tab--active {
      color: var(--color-primary, #6c63ff);
      border-bottom-color: var(--color-primary, #6c63ff); font-weight: 700;
    }

    /* ── Tables ── */
    .payroll-table th, .payroll-table td { padding: var(--space-xs) var(--space-sm); vertical-align: middle; }
    .payroll-loading { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-2xl); color: var(--color-text-muted); justify-content: center; }

    /* ── Adjustment rows ── */
    .adj-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) 0; border-bottom: 1px solid var(--color-border); }
    .adj-type { font-weight: 600; min-width: 90px; font-size: 0.82rem; }
    .adj-bonus      { color: var(--color-success, #38a169); }
    .adj-deduction  { color: var(--color-danger,  #e53e3e); }
    .adj-amount { font-family: var(--font-mono); min-width: 100px; }
    .adj-note   { flex: 1; font-size: 0.82rem; color: var(--color-text-muted); }

    /* ── Loan rows ── */
    .loan-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); padding: var(--space-sm) 0; border-bottom: 1px solid var(--color-border); }
    .loan-row__info    { display: flex; flex-direction: column; gap: 2px; }
    .loan-row__actions { flex-shrink: 0; }

    /* ── Modal (PART 2: theme-matched) ──
       Uses --color-bg-card for panel background to match the dark industrial theme.
       No white backgrounds. All text/border vars inherited from the app theme. */
    .pr-modal {
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,.6);
      display: flex; align-items: center; justify-content: center;
      animation: pr-backdrop-in .15s ease;
    }
    .pr-modal--exiting { animation: pr-backdrop-out .15s ease forwards; }
    @keyframes pr-backdrop-in  { from { opacity: 0; } to   { opacity: 1; } }
    @keyframes pr-backdrop-out { from { opacity: 1; } to   { opacity: 0; } }

    .pr-modal__panel {
      /* ← key fix: bg-card instead of white */
      background: var(--color-bg-card, #1e2025);
      color: var(--color-text-primary, #e2e8f0);
      border: 1px solid var(--color-border, #2d3748);
      border-radius: var(--radius-lg, 12px);
      width: min(580px, 94vw); max-height: 88vh;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,.45);
      animation: pr-panel-in .18s cubic-bezier(.34,1.56,.64,1);
    }
    .pr-modal--exiting .pr-modal__panel { animation: pr-panel-out .15s ease forwards; }
    @keyframes pr-panel-in  { from { transform: translateY(14px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes pr-panel-out { from { transform: none; opacity: 1; } to { transform: translateY(8px) scale(.98); opacity: 0; } }

    .pr-modal__header {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--space-md) var(--space-lg);
      background: var(--color-bg-card-header, var(--color-bg-card, #16181d));
      border-bottom: 1px solid var(--color-border, #2d3748);
      flex-shrink: 0;
    }
    .pr-modal__title {
      font-size: 1rem; font-weight: 700; margin: 0;
      color: var(--color-text-primary, #e2e8f0);
    }
    .pr-modal__body {
      padding: var(--space-lg); overflow-y: auto; flex: 1;
      color: var(--color-text, var(--color-text-primary, #e2e8f0));
    }

    /* Ensure form inputs inside modal pick up the right vars */
    .pr-modal__body .form-input,
    .pr-modal__body .form-select {
      background: var(--color-input-bg, var(--color-surface, #2d3748));
      color: var(--color-text, #e2e8f0);
      border-color: var(--color-border, #4a5568);
    }
    .pr-modal__body .form-label,
    .pr-modal__body .form-hint  { color: var(--color-text-muted, #a0aec0); }
  `;
  document.head.appendChild(s);
}