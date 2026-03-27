/**
 * reports.js — CapFlow Reports Module
 *
 * Two printable reports:
 *   1. Resumen mensual  — KPIs, production, sales and cost summary for one month
 *   2. Estado de ventas — full sale-by-sale breakdown for a date range
 *
 * Print behaviour:
 *   - window.print() is called from each report's print button
 *   - @media print CSS (injected by buildStyles()) hides all app chrome and
 *     renders only .report-printable on a white background
 *   - Charts (Chart.js canvas) print natively as raster images
 *   - Company name and report metadata appear in every printed page header
 *
 * Company: INDUSTRIAL RECICLING RAFS
 * Logo:    Not yet available — header uses text only.
 *          To add a logo in the future, set COMPANY_LOGO_URL to the image path
 *          and the header template will include it automatically.
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

import { SalesAPI }            from '../api.js';
import { ProductionAPI }       from '../api.js';
import { OperatorsAPI }        from '../api.js';
import { MachinesAPI }         from '../api.js';
import { ProductsAPI }         from '../api.js';
import { CustomersAPI }        from '../api.js';
import { RawMaterialsAPI }     from '../api.js';
import { MonthlyInventoryAPI } from '../api.js';
import { SalePaymentsAPI }     from '../api.js';
import { ExpensesAPI }         from '../api.js';
import { PayrollAPI }          from '../api.js';
import { EXPENSE_CATEGORIES }  from './expenses.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPANY_NAME    = 'INDUSTRIAL RECICLING RAFS';

const OVERHEAD_CATEGORIES = new Set([
  'Electricidad',
  'Alquiler — Fábrica',
  'Alquiler — Área de lavado',
  'Mantenimiento y reparaciones',
  'Agua potable (operarios)',
  'Materiales de limpieza',
  'Equipos y herramientas',
]);
const COMPANY_LOGO_URL = null; // set to image path when logo is available

// ─── Module State ─────────────────────────────────────────────────────────────

let _activeReport = 'monthly'; // 'monthly' | 'sales'

// Cached data — loaded once per mount
let _allSales       = [];
let _allProduction  = [];
let _allOperators   = [];
let _allMachines    = [];
let _allProducts    = [];
let _allCustomers   = [];
let _allPurchases   = [];
let _allInvRecords  = [];

// Lookup maps
let _operatorMap = new Map();
let _machineMap  = new Map();
let _productMap  = new Map();
let _customerMap = new Map();

/** All payment records — loaded once per mount, keyed by saleId. */
let _allPayments  = [];
let _paymentsMap  = new Map(); // saleId → payment[]

/** Expenses and payroll runs — loaded once per mount. */
let _allExpenses  = [];
let _allPayrolls  = [];

// Chart instances — destroyed on re-render
let _monthlyChart = null;
let _salesChart   = null;

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function mountReports(container) {
  container.innerHTML = buildShellHTML();

  // Inject print + module styles once
  if (!document.getElementById('reports-styles')) {
    document.head.insertAdjacentHTML('beforeend', buildStyles());
  }

  // Wire tab buttons
  container.querySelectorAll('.rpt-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeReport = btn.dataset.report;
      container.querySelectorAll('.rpt-tab-btn').forEach(b =>
        b.classList.toggle('rpt-tab-btn--active', b === btn));
      renderActiveReport(container);
    });
  });

  // Show loading state
  const body = document.getElementById('rpt-body');
  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;
                height:30vh;gap:12px;color:var(--color-text-muted);">
      <div class="spinner"></div><span>Cargando datos…</span>
    </div>`;

  try {
    const [sales, production, operators, machines, products,
           customers, purchases, invRecords, payments,
           expenses, payrolls] = await Promise.all([
      SalesAPI.getAll(),
      ProductionAPI.getAll(),
      OperatorsAPI.getAll(),
      MachinesAPI.getAll(),
      ProductsAPI.getAll(),
      CustomersAPI.getAll(),
      RawMaterialsAPI.getAll(),
      MonthlyInventoryAPI.getAll(),
      SalePaymentsAPI.getAll(),
      ExpensesAPI.getAll(),
      PayrollAPI.getAll(),
    ]);

    _allSales      = sales;
    _allPayments   = payments;
    _allExpenses   = expenses;
    _allPayrolls   = payrolls;
    _paymentsMap   = new Map();
    for (const p of (payments || [])) {
      const k = String(p.saleId);
      if (!_paymentsMap.has(k)) _paymentsMap.set(k, []);
      _paymentsMap.get(k).push(p);
    }
    _allProduction = production;
    _allOperators  = operators;
    _allMachines   = machines;
    _allProducts   = products;
    _allCustomers  = customers;
    _allPurchases  = purchases;
    _allInvRecords = invRecords;

    _operatorMap = new Map(operators.map(o => [String(o.id), o]));
    _machineMap  = new Map(machines.map(m  => [String(m.id), m]));
    _productMap  = new Map(products.map(p  => [String(p.id), p]));
    _customerMap = new Map(customers.map(c => [String(c.id), c]));

    renderActiveReport(container);

  } catch (err) {
    document.getElementById('rpt-body').innerHTML = `
      <div style="padding:var(--space-xl);color:var(--color-danger);font-family:var(--font-mono);">
        ✕ Error cargando datos: ${escapeHTML(err.message)}
      </div>`;
  }
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────

function buildShellHTML() {
  return `
    <section class="module" id="reports-module">
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">▦</span>
          <div>
            <h1 class="module-header__title">Reportes</h1>
            <p class="module-header__subtitle">Generación e impresión de reportes operativos</p>
          </div>
        </div>
      </header>

      <!-- Report type tabs -->
      <div class="rpt-tabs">
        <button class="rpt-tab-btn rpt-tab-btn--active" data-report="monthly">
          Resumen Mensual
        </button>
        <button class="rpt-tab-btn" data-report="sales">
          Estado de Ventas
        </button>
        <button class="rpt-tab-btn" data-report="ledger">
          Estado de Cuenta
        </button>
        <button class="rpt-tab-btn" data-report="expenses">
          Gastos
        </button>
      </div>

      <!-- Dynamic body -->
      <div id="rpt-body"></div>
    </section>
  `;
}

// ─── Report Router ────────────────────────────────────────────────────────────

function renderActiveReport(container) {
  if (_activeReport === 'monthly')   renderMonthlyReport(container);
  else if (_activeReport === 'sales') renderSalesReport(container);
  else if (_activeReport === 'ledger') renderLedgerReport(container);
  else                                renderExpensesReport(container);
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORT 1 — RESUMEN MENSUAL
// ══════════════════════════════════════════════════════════════════════════════

function renderMonthlyReport(container) {
  const currentMonth = todayYM();

  document.getElementById('rpt-body').innerHTML = `
    <div class="rpt-controls card">
      <div class="rpt-controls__row">
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-monthly-month">Mes</label>
          <input class="form-input" type="month" id="rpt-monthly-month"
                 value="${escapeHTML(currentMonth)}">
        </div>
        <button class="btn btn--primary" id="rpt-monthly-generate">
          Generar reporte
        </button>
        <button class="btn btn--ghost" id="rpt-monthly-print" style="display:none;">
          🖨 Imprimir / Guardar PDF
        </button>
      </div>
    </div>
    <div id="rpt-monthly-output"></div>
  `;

  document.getElementById('rpt-monthly-generate').addEventListener('click', () => {
    const month = document.getElementById('rpt-monthly-month').value;
    if (!month) return;
    buildMonthlyReportOutput(month);
  });

  document.getElementById('rpt-monthly-print').addEventListener('click', () => {
    window.print();
  });

  // Auto-generate for current month on load
  buildMonthlyReportOutput(currentMonth);
}

function buildMonthlyReportOutput(month) {
  const printBtn = document.getElementById('rpt-monthly-print');
  const output   = document.getElementById('rpt-monthly-output');
  if (!output) return;

  const monthLabel = formatMonthLabel(month);

  // ── Filter data to month ──────────────────────────────────────────────────
  const monthSales = _allSales.filter(s => (s.month || '') === month);
  const monthProd  = _allProduction.filter(r =>
    (r.productionDate || '').startsWith(month));

  // ── Sales KPIs ────────────────────────────────────────────────────────────
  const revenue = monthSales.reduce((s, x) => s + (x.totals?.revenue || 0), 0);
  const cost    = monthSales.reduce((s, x) => s + (x.totals?.cost    || 0), 0);
  const profit  = monthSales.reduce((s, x) => s + (x.totals?.profit  || 0), 0);
  const margin  = revenue > 0 ? (profit / revenue) * 100 : null;

  // ── Production KPIs ───────────────────────────────────────────────────────
  const shifts    = monthProd.length;
  const units     = monthProd.reduce((s, r) => s + (r.quantity || 0), 0);
  const laborCost = monthProd.reduce(
    (s, r) => s + (r.quantity || 0) * (r.operatorRateSnapshot || 0), 0);

  // ── Cost per package ──────────────────────────────────────────────────────
  const prevMonth   = prevMonthYM(month);
  const currInv     = _allInvRecords.find(r => r.month === month)  || null;
  const prevInv     = _allInvRecords.find(r => r.month === prevMonth) || null;
  const monthPurchases = _allPurchases.filter(r => (r.date || '').startsWith(month));

  let materialCost = 0;
  for (const type of ['recycled', 'pellet']) {
    const tp = monthPurchases.filter(r => r.materialType === type);
    const purchLbs  = tp.reduce((s, r) => s + (r.weightLbs || 0), 0);
    const purchCost = tp.reduce((s, r) => s + (r.totalCost || 0) + (r.washingCost || 0), 0);
    const avgCost   = purchLbs > 0 ? purchCost / purchLbs : 0;
    const closingKey = type === 'recycled' ? 'recycledClosingLbs' : 'pelletClosingLbs';
    const opening   = prevInv ? (prevInv[closingKey] || 0) : 0;
    const closing   = currInv ? (currInv[closingKey] || 0) : 0;
    materialCost   += (opening + purchLbs - closing) * avgCost;
  }

  // Manufacturing overhead: sum of overhead-category expenses this month
  const overheadCost = _allExpenses
    .filter(e => OVERHEAD_CATEGORIES.has(e.category) && (e.expenseDate || '').startsWith(month))
    .reduce((s, e) => s + (e.amount || 0), 0);

  const totalCost    = laborCost + materialCost + overheadCost;
  const costPerPkg   = units > 0 ? totalCost / units : null;
  const closingEntered = !!currInv;

  // ── Top operator & machine ────────────────────────────────────────────────
  const topOpEntry  = topByField(monthProd, 'operatorId', 'quantity');
  const topMachEntry= topByField(monthProd, 'machineId',  null);
  const topOpName   = topOpEntry
    ? (_operatorMap.get(String(topOpEntry.id))?.name || '[Eliminado]') : null;
  const topMachName = topMachEntry
    ? (_machineMap.get(String(topMachEntry.id))?.name || '[Eliminada]') : null;

  // ── Sales by customer ─────────────────────────────────────────────────────
  const byCustomer = new Map();
  for (const s of monthSales) {
    const cid  = String(s.clientId || '');
    const name = _customerMap.get(cid)?.name || '[Cliente eliminado]';
    const cur  = byCustomer.get(cid) || { name, revenue: 0, profit: 0, count: 0 };
    cur.revenue += s.totals?.revenue || 0;
    cur.profit  += s.totals?.profit  || 0;
    cur.count   += 1;
    byCustomer.set(cid, cur);
  }
  const customerRows = [...byCustomer.values()]
    .sort((a, b) => b.revenue - a.revenue);

  // ── 6-month trend data ────────────────────────────────────────────────────
  const trendMonths = [];
  for (let i = 5; i >= 0; i--) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 - i, 1);
    trendMonths.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  const trendLabels  = trendMonths.map(m => shortMonthLabel(m));
  const trendRevenue = trendMonths.map(m =>
    _allSales.filter(s => s.month === m).reduce((s, x) => s + (x.totals?.revenue || 0), 0));
  const trendCost    = trendMonths.map(m =>
    _allSales.filter(s => s.month === m).reduce((s, x) => s + (x.totals?.cost || 0), 0));
  const trendProfit  = trendRevenue.map((r, i) => r - trendCost[i]);

  // ── Render ────────────────────────────────────────────────────────────────
  output.innerHTML = `
    <div class="report-printable" id="rpt-monthly-printable">

      ${buildReportHeader('Resumen Mensual', monthLabel)}

      <!-- Sales summary -->
      <div class="rpt-section">
        <h2 class="rpt-section__title">Ventas</h2>
        <div class="rpt-kpi-grid">
          ${rptKPI('Ingresos',    formatCurrency(revenue), '')}
          ${rptKPI('Costos',      formatCurrency(cost),    '')}
          ${rptKPI('Ganancia',    formatCurrency(profit),  '', profit >= 0 ? 'positive' : 'negative')}
          ${rptKPI('Margen',      margin !== null ? margin.toFixed(1) + ' %' : '—', '')}
          ${rptKPI('Transacciones', formatNumber(monthSales.length), '')}
        </div>
      </div>

      <!-- Production summary -->
      <div class="rpt-section">
        <h2 class="rpt-section__title">Producción</h2>
        <div class="rpt-kpi-grid">
          ${rptKPI('Turnos',          formatNumber(shifts), '')}
          ${rptKPI('Unidades producidas', formatNumber(units), '')}
          ${rptKPI('Costo laboral',   formatCurrency(laborCost), '')}
          ${rptKPI('Costo material',   closingEntered ? formatCurrency(materialCost) : '—', closingEntered ? '' : 'Cierre pendiente')}
          ${rptKPI('Gastos indirectos', formatCurrency(overheadCost), overheadCost === 0 ? 'Sin gastos registrados' : '')}
          ${rptKPI('Costo por paquete', costPerPkg !== null && closingEntered ? formatCurrency(costPerPkg) : '—', closingEntered ? '' : 'Cierre pendiente')}
        </div>
      </div>

      <!-- Highlights -->
      ${topOpName || topMachName ? `
      <div class="rpt-section">
        <h2 class="rpt-section__title">Destacados del mes</h2>
        <div class="rpt-kpi-grid">
          ${topOpName   ? rptKPI('Top operario',  topOpName,   formatNumber(topOpEntry.total) + ' unidades') : ''}
          ${topMachName ? rptKPI('Máquina líder', topMachName, formatNumber(topMachEntry.total) + ' turnos') : ''}
        </div>
      </div>` : ''}

      <!-- Sales by customer -->
      ${customerRows.length > 0 ? `
      <div class="rpt-section">
        <h2 class="rpt-section__title">Ventas por cliente</h2>
        <table class="rpt-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th class="text-right">Transacciones</th>
              <th class="text-right">Ingresos</th>
              <th class="text-right">Ganancia</th>
            </tr>
          </thead>
          <tbody>
            ${customerRows.map(c => `
              <tr>
                <td>${escapeHTML(c.name)}</td>
                <td class="text-right">${formatNumber(c.count)}</td>
                <td class="text-right">${formatCurrency(c.revenue)}</td>
                <td class="text-right" class="${c.profit >= 0 ? 'rpt-positive' : 'rpt-negative'}">
                  ${formatCurrency(c.profit)}
                </td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th class="text-right">${formatNumber(monthSales.length)}</th>
              <th class="text-right">${formatCurrency(revenue)}</th>
              <th class="text-right">${formatCurrency(profit)}</th>
            </tr>
          </tfoot>
        </table>
      </div>` : ''}

      <!-- 6-month trend chart -->
      <div class="rpt-section rpt-chart-section">
        <h2 class="rpt-section__title">Tendencia — últimos 6 meses</h2>
        <div class="rpt-chart-wrap">
          <canvas id="rpt-monthly-chart"></canvas>
        </div>
      </div>

      ${buildReportFooter()}
    </div>
  `;

  // Render chart after DOM is in place
  renderMonthlyTrendChart(trendLabels, trendRevenue, trendCost, trendProfit);

  if (printBtn) printBtn.style.display = '';
}

function renderMonthlyTrendChart(labels, revenue, cost, profit) {
  if (typeof window.Chart === 'undefined') return;
  const canvas = document.getElementById('rpt-monthly-chart');
  if (!canvas) return;

  if (_monthlyChart) { _monthlyChart.destroy(); _monthlyChart = null; }

  _monthlyChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Ingresos',
          data: revenue,
          backgroundColor: 'rgba(74,158,255,0.25)',
          borderColor: 'rgba(74,158,255,0.9)',
          borderWidth: 1.5,
          borderRadius: 3,
          order: 2,
        },
        {
          label: 'Costos',
          data: cost,
          backgroundColor: 'rgba(231,76,60,0.2)',
          borderColor: 'rgba(231,76,60,0.8)',
          borderWidth: 1.5,
          borderRadius: 3,
          order: 3,
        },
        {
          label: 'Ganancia',
          data: profit,
          type: 'line',
          borderColor: 'rgba(46,204,113,0.9)',
          backgroundColor: 'rgba(46,204,113,0.1)',
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.3,
          fill: true,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 14 },
        },
        tooltip: {
          callbacks: {
            label: item => ` ${item.dataset.label}: ${
              new Intl.NumberFormat('es-DO', {
                style: 'currency', currency: 'DOP', minimumFractionDigits: 0,
              }).format(item.raw)
            }`,
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => new Intl.NumberFormat('es-DO', {
              notation: 'compact', compactDisplay: 'short',
            }).format(v),
            font: { size: 10 },
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORT 2 — ESTADO DE VENTAS
// ══════════════════════════════════════════════════════════════════════════════

function renderSalesReport(container) {
  // Default: current month start → today
  const today     = todayYMD();
  const monthFrom = today.slice(0, 7) + '-01';

  document.getElementById('rpt-body').innerHTML = `
    <div class="rpt-controls card">
      <div class="rpt-controls__row">
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-sales-from">Desde</label>
          <input class="form-input" type="date" id="rpt-sales-from"
                 value="${escapeHTML(monthFrom)}">
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-sales-to">Hasta</label>
          <input class="form-input" type="date" id="rpt-sales-to"
                 value="${escapeHTML(today)}">
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-sales-customer">Cliente</label>
          <select class="form-input form-select" id="rpt-sales-customer">
            <option value="">Todos los clientes</option>
            ${[..._customerMap.values()]
                .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                .map(c => `<option value="${escapeHTML(String(c.id))}">${escapeHTML(c.name)}</option>`)
                .join('')}
          </select>
        </div>
        <button class="btn btn--primary" id="rpt-sales-generate">
          Generar reporte
        </button>
        <button class="btn btn--ghost" id="rpt-sales-print" style="display:none;">
          🖨 Imprimir / Guardar PDF
        </button>
      </div>
    </div>
    <div id="rpt-sales-output"></div>
  `;

  document.getElementById('rpt-sales-generate').addEventListener('click', () => {
    const from     = document.getElementById('rpt-sales-from').value;
    const to       = document.getElementById('rpt-sales-to').value;
    const customer = document.getElementById('rpt-sales-customer').value;
    if (!from || !to) return;
    if (from > to) {
      alert('La fecha de inicio no puede ser posterior a la fecha final.');
      return;
    }
    buildSalesReportOutput(from, to, customer);
  });

  document.getElementById('rpt-sales-print').addEventListener('click', () => {
    window.print();
  });

  // Auto-generate on load
  buildSalesReportOutput(monthFrom, today, '');
}

function buildSalesReportOutput(from, to, customerId) {
  const printBtn = document.getElementById('rpt-sales-print');
  const output   = document.getElementById('rpt-sales-output');
  if (!output) return;

  // ── Filter ────────────────────────────────────────────────────────────────
  let sales = _allSales.filter(s => {
    const d = s.saleDate || '';
    return d >= from && d <= to;
  });
  if (customerId) {
    sales = sales.filter(s => String(s.clientId) === customerId);
  }
  sales = [...sales].sort((a, b) => (a.saleDate || '').localeCompare(b.saleDate || ''));

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalRevenue = sales.reduce((s, x) => s + (x.totals?.revenue || 0), 0);
  const totalCost    = sales.reduce((s, x) => s + (x.totals?.cost    || 0), 0);
  const totalProfit  = sales.reduce((s, x) => s + (x.totals?.profit  || 0), 0);
  const totalMargin  = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : null;

  // ── Period label ──────────────────────────────────────────────────────────
  const customerName = customerId
    ? (_customerMap.get(customerId)?.name || 'Cliente')
    : 'Todos los clientes';
  const periodLabel  = `${formatDateLabel(from)} — ${formatDateLabel(to)}`;

  // ── Revenue by customer (for summary chart) ───────────────────────────────
  const byCustomer = new Map();
  for (const s of sales) {
    const cid  = String(s.clientId || '');
    const name = _customerMap.get(cid)?.name || '[Eliminado]';
    const cur  = byCustomer.get(cid) || { name, revenue: 0, profit: 0, count: 0 };
    cur.revenue += s.totals?.revenue || 0;
    cur.profit  += s.totals?.profit  || 0;
    cur.count   += 1;
    byCustomer.set(cid, cur);
  }
  const customerSummary = [...byCustomer.values()]
    .sort((a, b) => b.revenue - a.revenue);

  // ── Render ────────────────────────────────────────────────────────────────
  const subtitleLine = customerId
    ? `${escapeHTML(customerName)} · ${escapeHTML(periodLabel)}`
    : escapeHTML(periodLabel);

  output.innerHTML = `
    <div class="report-printable" id="rpt-sales-printable">

      ${buildReportHeader('Estado de Ventas', subtitleLine)}

      <!-- Summary KPIs -->
      <div class="rpt-section">
        <h2 class="rpt-section__title">Resumen del período</h2>
        <div class="rpt-kpi-grid">
          ${rptKPI('Ventas realizadas', formatNumber(sales.length), '')}
          ${rptKPI('Ingresos totales',  formatCurrency(totalRevenue), '')}
          ${rptKPI('Costos totales',    formatCurrency(totalCost),    '')}
          ${rptKPI('Ganancia neta',     formatCurrency(totalProfit),  '', totalProfit >= 0 ? 'positive' : 'negative')}
          ${rptKPI('Margen promedio',   totalMargin !== null ? totalMargin.toFixed(1) + ' %' : '—', '')}
        </div>
      </div>

      <!-- Sales by customer (only when showing all customers) -->
      ${!customerId && customerSummary.length > 1 ? `
      <div class="rpt-section">
        <h2 class="rpt-section__title">Por cliente</h2>
        <table class="rpt-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th class="text-right">Ventas</th>
              <th class="text-right">Ingresos</th>
              <th class="text-right">Ganancia</th>
              <th class="text-right">Margen</th>
            </tr>
          </thead>
          <tbody>
            ${customerSummary.map(c => {
              const m = c.revenue > 0 ? (c.profit / c.revenue * 100).toFixed(1) + ' %' : '—';
              return `<tr>
                <td>${escapeHTML(c.name)}</td>
                <td class="text-right">${formatNumber(c.count)}</td>
                <td class="text-right">${formatCurrency(c.revenue)}</td>
                <td class="text-right ${c.profit >= 0 ? 'rpt-positive' : 'rpt-negative'}">
                  ${formatCurrency(c.profit)}</td>
                <td class="text-right">${m}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th class="text-right">${formatNumber(sales.length)}</th>
              <th class="text-right">${formatCurrency(totalRevenue)}</th>
              <th class="text-right">${formatCurrency(totalProfit)}</th>
              <th class="text-right">${totalMargin !== null ? totalMargin.toFixed(1) + ' %' : '—'}</th>
            </tr>
          </tfoot>
        </table>
      </div>` : ''}

      <!-- Full sale listing -->
      <div class="rpt-section">
        <h2 class="rpt-section__title">Detalle de ventas</h2>
        ${sales.length === 0 ? `
          <p style="color:var(--color-text-muted);font-size:0.9rem;padding:var(--space-md) 0;">
            No hay ventas registradas en este período.
          </p>
        ` : `
        <table class="rpt-table rpt-table--sm">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Factura</th>
              <th>Cliente</th>
              <th>Líneas</th>
              <th class="text-right">Ingresos</th>
              <th class="text-right">Costos</th>
              <th class="text-right">Ganancia</th>
              <th class="text-right">Margen</th>
            </tr>
          </thead>
          <tbody>
            ${sales.map(s => {
              const t    = s.totals || {};
              const m    = t.revenue > 0
                ? ((t.profit || 0) / t.revenue * 100).toFixed(1) + ' %' : '—';
              const cust = _customerMap.get(String(s.clientId || ''))?.name || '—';
              const lines = Array.isArray(s.lines) ? s.lines.length : '—';
              return `<tr>
                <td style="white-space:nowrap;">${escapeHTML(formatDateLabel(s.saleDate || ''))}</td>
                <td style="font-family:var(--font-mono);font-size:0.8rem;">
                  ${escapeHTML(s.invoiceNumber || '—')}</td>
                <td>${escapeHTML(cust)}</td>
                <td class="text-right">${lines}</td>
                <td class="text-right">${formatCurrency(t.revenue || 0)}</td>
                <td class="text-right">${formatCurrency(t.cost    || 0)}</td>
                <td class="text-right ${(t.profit || 0) >= 0 ? 'rpt-positive' : 'rpt-negative'}">
                  ${formatCurrency(t.profit || 0)}</td>
                <td class="text-right">${m}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="4">Total (${formatNumber(sales.length)} ventas)</th>
              <th class="text-right">${formatCurrency(totalRevenue)}</th>
              <th class="text-right">${formatCurrency(totalCost)}</th>
              <th class="text-right">${formatCurrency(totalProfit)}</th>
              <th class="text-right">
                ${totalMargin !== null ? totalMargin.toFixed(1) + ' %' : '—'}
              </th>
            </tr>
          </tfoot>
        </table>`}
      </div>

      ${buildReportFooter()}
    </div>
  `;

  if (printBtn) printBtn.style.display = '';
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORT 3 — ESTADO DE CUENTA (Sales Ledger)
// Clean chronological ledger — one row per invoice, no charts, no KPIs.
// ══════════════════════════════════════════════════════════════════════════════

function renderLedgerReport(container) {
  const today     = todayYMD();
  const monthFrom = today.slice(0, 7) + '-01';

  document.getElementById('rpt-body').innerHTML = `
    <div class="rpt-controls card">
      <div class="rpt-controls__row">
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-ledger-from">Desde</label>
          <input class="form-input" type="date" id="rpt-ledger-from"
                 value="${escapeHTML(monthFrom)}">
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-ledger-to">Hasta</label>
          <input class="form-input" type="date" id="rpt-ledger-to"
                 value="${escapeHTML(today)}">
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-ledger-customer">Cliente</label>
          <select class="form-input form-select" id="rpt-ledger-customer">
            <option value="">Todos los clientes</option>
            ${[..._customerMap.values()]
                .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                .map(c => `<option value="${escapeHTML(String(c.id))}">${escapeHTML(c.name)}</option>`)
                .join('')}
          </select>
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-ledger-status">Estado de pago</label>
          <select class="form-input form-select" id="rpt-ledger-status">
            <option value="">Todos</option>
            <option value="paid">Cobrado</option>
            <option value="partial">Parcial</option>
            <option value="unpaid">Pendiente</option>
          </select>
        </div>
        <button class="btn btn--primary" id="rpt-ledger-generate">Generar</button>
        <button class="btn btn--ghost" id="rpt-ledger-print" style="display:none;">
          🖨 Imprimir / Guardar PDF
        </button>
      </div>
    </div>
    <div id="rpt-ledger-output"></div>
  `;

  document.getElementById('rpt-ledger-generate').addEventListener('click', () => {
    const from     = document.getElementById('rpt-ledger-from').value;
    const to       = document.getElementById('rpt-ledger-to').value;
    const customer = document.getElementById('rpt-ledger-customer').value;
    const status   = document.getElementById('rpt-ledger-status').value;
    if (!from || !to) return;
    if (from > to) { alert('La fecha de inicio no puede ser posterior a la fecha final.'); return; }
    buildLedgerOutput(from, to, customer, status);
  });

  document.getElementById('rpt-ledger-print').addEventListener('click', () => window.print());

  buildLedgerOutput(monthFrom, today, '', '');
}

function buildLedgerOutput(from, to, customerId, statusFilter) {
  const printBtn = document.getElementById('rpt-ledger-print');
  const output   = document.getElementById('rpt-ledger-output');
  if (!output) return;

  // ── Payment status helper ─────────────────────────────────────────────────
  function getStatus(saleId, revenue) {
    const payments  = _paymentsMap.get(String(saleId)) || [];
    const paid      = payments.reduce((s, p) => s + p.amount, 0);
    const balance   = Math.max(0, (revenue || 0) - paid);
    if (paid <= 0)          return { status: 'unpaid',  paid, balance };
    if (balance <= 0.01)    return { status: 'paid',    paid, balance: 0 };
    return                         { status: 'partial', paid, balance };
  }

  const STATUS_LABEL = { paid: 'Cobrado', partial: 'Parcial', unpaid: 'Pendiente' };
  const STATUS_CLASS = { paid: 'rpt-status--paid', partial: 'rpt-status--partial', unpaid: 'rpt-status--unpaid' };

  // ── Filter ────────────────────────────────────────────────────────────────
  let rows = _allSales
    .filter(s => {
      const d = s.saleDate || '';
      return d >= from && d <= to;
    })
    .map(s => {
      const t = s.totals || {};
      const { status, paid, balance } = getStatus(s.id, t.revenue);
      return { ...s, _status: status, _paid: paid, _balance: balance };
    });

  if (customerId) rows = rows.filter(s => String(s.clientId) === customerId);
  if (statusFilter) rows = rows.filter(s => s._status === statusFilter);

  rows = rows.sort((a, b) => (a.saleDate || '').localeCompare(b.saleDate || ''));

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalRevenue = rows.reduce((s, x) => s + (x.totals?.revenue || 0), 0);
  const totalPaid    = rows.reduce((s, x) => s + x._paid, 0);
  const totalBalance = rows.reduce((s, x) => s + x._balance, 0);

  // ── Labels ────────────────────────────────────────────────────────────────
  const custName   = customerId ? (_customerMap.get(customerId)?.name || 'Cliente') : null;
  const statusName = statusFilter ? STATUS_LABEL[statusFilter] : null;
  const filterParts = [custName, statusName].filter(Boolean);
  const subtitle   = filterParts.length
    ? `${filterParts.join(' · ')} · ${escapeHTML(formatDateLabel(from))} — ${escapeHTML(formatDateLabel(to))}`
    : `${escapeHTML(formatDateLabel(from))} — ${escapeHTML(formatDateLabel(to))}`;

  // ── Render ────────────────────────────────────────────────────────────────
  output.innerHTML = `
    <div class="report-printable" id="rpt-ledger-printable">

      ${buildReportHeader('Estado de Cuenta', subtitle)}

      <div class="rpt-section">
        ${rows.length === 0 ? `
          <p style="color:var(--color-text-muted);font-size:0.9rem;padding:var(--space-md) 0;">
            No hay transacciones en este período con los filtros seleccionados.
          </p>
        ` : `
        <table class="rpt-table rpt-table--sm rpt-table--ledger">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>N° Factura</th>
              <th>Cliente</th>
              <th class="text-right">Total factura</th>
              <th class="text-right">Total cobrado</th>
              <th class="text-right">Saldo</th>
              <th class="text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(s => {
              const t    = s.totals || {};
              const cust = _customerMap.get(String(s.clientId || ''))?.name || '—';
              return `<tr>
                <td style="white-space:nowrap;">${escapeHTML(formatDateLabel(s.saleDate || ''))}</td>
                <td style="font-family:var(--font-mono);font-size:0.78rem;">
                  ${escapeHTML(s.invoiceNumber || '—')}</td>
                <td>${escapeHTML(cust)}</td>
                <td class="text-right">${formatCurrency(t.revenue || 0)}</td>
                <td class="text-right" style="color:var(--color-success);">
                  ${formatCurrency(s._paid)}</td>
                <td class="text-right" style="color:${s._balance > 0 ? 'var(--color-danger)' : 'inherit'};">
                  ${formatCurrency(s._balance)}</td>
                <td class="text-center">
                  <span class="rpt-status-badge ${STATUS_CLASS[s._status]}">
                    ${STATUS_LABEL[s._status]}
                  </span>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="3">Total (${formatNumber(rows.length)} transaccion${rows.length !== 1 ? 'es' : ''})</th>
              <th class="text-right">${formatCurrency(totalRevenue)}</th>
              <th class="text-right">${formatCurrency(totalPaid)}</th>
              <th class="text-right" style="color:${totalBalance > 0 ? 'var(--color-danger)' : 'inherit'};">
                ${formatCurrency(totalBalance)}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>`}
      </div>

      ${buildReportFooter()}
    </div>
  `;

  if (printBtn) printBtn.style.display = '';
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORT 4 — GASTOS
// ══════════════════════════════════════════════════════════════════════════════

function renderExpensesReport(container) {
  const today     = todayYMD();
  const monthFrom = today.slice(0, 7) + '-01';

  // Build category options for filter (grouped)
  const catOptions = EXPENSE_CATEGORIES.map(c =>
    `<option value="${escapeHTML(c.label)}">${escapeHTML(c.label)}</option>`
  ).join('');

  document.getElementById('rpt-body').innerHTML = `
    <div class="rpt-controls card">
      <div class="rpt-controls__row">
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-exp-from">Desde</label>
          <input class="form-input" type="date" id="rpt-exp-from"
                 value="${escapeHTML(monthFrom)}">
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-exp-to">Hasta</label>
          <input class="form-input" type="date" id="rpt-exp-to"
                 value="${escapeHTML(today)}">
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-exp-category">Categoría</label>
          <select class="form-input form-select" id="rpt-exp-category">
            <option value="">Todas las categorías</option>
            ${catOptions}
          </select>
        </div>
        <div class="form-group" style="flex:0 0 auto;">
          <label class="form-label" for="rpt-exp-payroll">Nómina</label>
          <select class="form-input form-select" id="rpt-exp-payroll">
            <option value="include">Incluir nómina</option>
            <option value="exclude">Excluir nómina</option>
          </select>
        </div>
        <button class="btn btn--primary" id="rpt-exp-generate">Generar</button>
        <button class="btn btn--ghost" id="rpt-exp-print" style="display:none;">
          🖨 Imprimir / Guardar PDF
        </button>
      </div>
    </div>
    <div id="rpt-exp-output"></div>
  `;

  document.getElementById('rpt-exp-generate').addEventListener('click', () => {
    const from        = document.getElementById('rpt-exp-from').value;
    const to          = document.getElementById('rpt-exp-to').value;
    const category    = document.getElementById('rpt-exp-category').value;
    const incPayroll  = document.getElementById('rpt-exp-payroll').value === 'include';
    if (!from || !to) return;
    if (from > to) { alert('La fecha de inicio no puede ser posterior a la fecha final.'); return; }
    buildExpensesOutput(from, to, category, incPayroll);
  });

  document.getElementById('rpt-exp-print').addEventListener('click', () => window.print());

  buildExpensesOutput(monthFrom, today, '', true);
}

function buildExpensesOutput(from, to, categoryFilter, includePayroll) {
  const printBtn = document.getElementById('rpt-exp-print');
  const output   = document.getElementById('rpt-exp-output');
  if (!output) return;

  const methodLabel = {
    efectivo: 'Efectivo', transferencia: 'Transferencia',
    cheque: 'Cheque', otro: 'Otro',
  };

  // ── Filter expenses ───────────────────────────────────────────────────────
  let rows = _allExpenses.filter(e => {
    const d = e.expenseDate || '';
    return d >= from && d <= to;
  });
  if (categoryFilter) rows = rows.filter(e => e.category === categoryFilter);
  rows = [...rows].sort((a, b) => (a.expenseDate || '').localeCompare(b.expenseDate || ''));

  // ── Payroll for period ────────────────────────────────────────────────────
  // Sum net pay from all closed payroll runs whose month falls within the period.
  // We match by month prefix since payroll runs are per-month.
  let payrollTotal = 0;
  let payrollRows  = [];
  if (includePayroll) {
    const fromMonth = from.slice(0, 7);
    const toMonth   = to.slice(0, 7);
    const eligible  = _allPayrolls.filter(pr => {
      const m = (pr.month || '').slice(0, 7);
      return m >= fromMonth && m <= toMonth;
    });
    // Group by month — sum net from both quincenas
    const byMonth = new Map();
    for (const pr of eligible) {
      const m   = (pr.month || '').slice(0, 7);
      const net = pr.totals?.net || 0;
      byMonth.set(m, (byMonth.get(m) || 0) + net);
    }
    payrollRows = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, net]) => ({ month, net }));
    payrollTotal = payrollRows.reduce((s, r) => s + r.net, 0);
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const expenseTotal = rows.reduce((s, e) => s + e.amount, 0);
  const grandTotal   = expenseTotal + payrollTotal;

  // ── By-category summary ───────────────────────────────────────────────────
  const byCat = new Map();
  for (const e of rows) {
    byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
  }
  const catSummary = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, total]) => ({ cat, total }));

  // ── Labels ────────────────────────────────────────────────────────────────
  const periodLabel = `${escapeHTML(formatDateLabel(from))} — ${escapeHTML(formatDateLabel(to))}`;
  const subtitle    = categoryFilter
    ? `${escapeHTML(categoryFilter)} · ${periodLabel}`
    : periodLabel;

  // ── Render ────────────────────────────────────────────────────────────────
  output.innerHTML = `
    <div class="report-printable" id="rpt-exp-printable">

      ${buildReportHeader('Reporte de Gastos', subtitle)}

      <!-- Summary KPIs -->
      <div class="rpt-section">
        <h2 class="rpt-section__title">Resumen del período</h2>
        <div class="rpt-kpi-grid">
          ${rptKPI('Gastos operativos',   formatCurrency(expenseTotal), `${formatNumber(rows.length)} registro${rows.length !== 1 ? 's' : ''}`)}
          ${includePayroll
            ? rptKPI('Nómina', formatCurrency(payrollTotal), `${payrollRows.length} período${payrollRows.length !== 1 ? 's' : ''}`)
            : ''}
          ${rptKPI('Total egresos', formatCurrency(grandTotal), '', 'negative')}
        </div>
      </div>

      <!-- By-category summary (only when showing all categories) -->
      ${!categoryFilter && catSummary.length > 0 ? `
      <div class="rpt-section">
        <h2 class="rpt-section__title">Por categoría</h2>
        <table class="rpt-table rpt-table--sm">
          <thead>
            <tr>
              <th>Categoría</th>
              <th class="text-right">Total</th>
              <th class="text-right">% del total operativo</th>
            </tr>
          </thead>
          <tbody>
            ${catSummary.map(({ cat, total }) => {
              const pct = expenseTotal > 0 ? (total / expenseTotal * 100).toFixed(1) : '0.0';
              return `<tr>
                <td>${escapeHTML(cat)}</td>
                <td class="text-right">${formatCurrency(total)}</td>
                <td class="text-right">${pct} %</td>
              </tr>`;
            }).join('')}
            ${includePayroll && payrollTotal > 0 ? `
            <tr style="opacity:0.7;">
              <td><em>Nómina</em></td>
              <td class="text-right">${formatCurrency(payrollTotal)}</td>
              <td class="text-right">—</td>
            </tr>` : ''}
          </tbody>
          <tfoot>
            <tr>
              <th>Total egresos</th>
              <th class="text-right">${formatCurrency(grandTotal)}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>` : ''}

      <!-- Payroll detail -->
      ${includePayroll && payrollRows.length > 0 ? `
      <div class="rpt-section">
        <h2 class="rpt-section__title">Nómina incluida</h2>
        <table class="rpt-table rpt-table--sm">
          <thead>
            <tr>
              <th>Mes</th>
              <th class="text-right">Total neto pagado</th>
            </tr>
          </thead>
          <tbody>
            ${payrollRows.map(r => `
              <tr>
                <td>${escapeHTML(formatMonthLabel(r.month))}</td>
                <td class="text-right">${formatCurrency(r.net)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th>Total nómina</th>
              <th class="text-right">${formatCurrency(payrollTotal)}</th>
            </tr>
          </tfoot>
        </table>
      </div>` : ''}

      <!-- Full expense listing -->
      <div class="rpt-section">
        <h2 class="rpt-section__title">Detalle de gastos operativos</h2>
        ${rows.length === 0 ? `
          <p style="color:var(--color-text-muted);font-size:0.9rem;padding:var(--space-md) 0;">
            No hay gastos registrados en este período${categoryFilter ? ' para esta categoría' : ''}.
          </p>
        ` : `
        <table class="rpt-table rpt-table--sm">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Categoría</th>
              <th>Descripción</th>
              <th>Método</th>
              <th class="text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(e => `
              <tr>
                <td style="white-space:nowrap;">${escapeHTML(formatDateLabel(e.expenseDate || ''))}</td>
                <td style="font-size:0.8rem;">${escapeHTML(e.category)}</td>
                <td>
                  ${escapeHTML(e.description)}
                  ${e.notes ? `<br><span style="font-size:0.75rem;color:#888;">${escapeHTML(e.notes)}</span>` : ''}
                </td>
                <td>${escapeHTML(methodLabel[e.method] || e.method)}</td>
                <td class="text-right">${formatCurrency(e.amount)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="4">Total gastos operativos (${formatNumber(rows.length)} registro${rows.length !== 1 ? 's' : ''})</th>
              <th class="text-right">${formatCurrency(expenseTotal)}</th>
            </tr>
          </tfoot>
        </table>`}
      </div>

      ${buildReportFooter()}
    </div>
  `;

  if (printBtn) printBtn.style.display = '';
}

// ─── Shared Report Fragments ──────────────────────────────────────────────────

/**
 * Printable page header with company name and report metadata.
 * Logo block is reserved for when COMPANY_LOGO_URL is set.
 */
function buildReportHeader(reportTitle, subtitle) {
  const logoHTML = COMPANY_LOGO_URL
    ? `<img src="${escapeHTML(COMPANY_LOGO_URL)}" class="rpt-header__logo" alt="Logo">`
    : '';

  return `
    <div class="rpt-header">
      <div class="rpt-header__left">
        ${logoHTML}
        <div class="rpt-header__company">${escapeHTML(COMPANY_NAME)}</div>
      </div>
      <div class="rpt-header__right">
        <div class="rpt-header__report-title">${escapeHTML(reportTitle)}</div>
        <div class="rpt-header__subtitle">${subtitle}</div>
        <div class="rpt-header__generated">
          Generado el ${escapeHTML(formatDateLabel(todayYMD()))}
        </div>
      </div>
    </div>
    <hr class="rpt-divider">
  `;
}

function buildReportFooter() {
  return `
    <div class="rpt-footer">
      <span>${escapeHTML(COMPANY_NAME)}</span>
      <span>CapFlow ERP</span>
      <span>Generado el ${escapeHTML(formatDateLabel(todayYMD()))}</span>
    </div>
  `;
}

/** Single KPI tile for the report grid. */
function rptKPI(label, value, sub, modifier = '') {
  const valClass = modifier === 'positive' ? ' rpt-positive'
                 : modifier === 'negative' ? ' rpt-negative' : '';
  return `
    <div class="rpt-kpi">
      <div class="rpt-kpi__label">${escapeHTML(label)}</div>
      <div class="rpt-kpi__value${valClass}">${escapeHTML(value)}</div>
      ${sub ? `<div class="rpt-kpi__sub">${escapeHTML(sub)}</div>` : ''}
    </div>
  `;
}

// ─── Calculation Helpers ──────────────────────────────────────────────────────

/**
 * Find the entity with highest sum of `valueField` (or count if null) grouped by `groupKey`.
 * Returns { id, total } or null.
 */
function topByField(records, groupKey, valueField) {
  if (!records.length) return null;
  const totals = new Map();
  for (const r of records) {
    const key = String(r[groupKey] || '');
    const val = valueField ? (r[valueField] || 0) : 1;
    totals.set(key, (totals.get(key) || 0) + val);
  }
  let best = null;
  for (const [id, total] of totals) {
    if (!best || total > best.total) best = { id, total };
  }
  return best;
}

function prevMonthYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayYM() { return todayYMD().slice(0, 7); }

function formatMonthLabel(ym) {
  if (!ym) return '';
  const d = new Date(`${ym}-01T00:00:00`);
  if (isNaN(d)) return ym;
  return d.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
}

function shortMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const mo = d.toLocaleDateString('es-DO', { month: 'short' }).replace('.', '').toLowerCase();
  return `${mo} ${String(y).slice(2)}`;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO', {
    style: 'currency', currency: 'DOP', minimumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO').format(value);
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function buildStyles() {
  return `
  <style id="reports-styles">

  /* ── Module tabs ──────────────────────────────────────────────────── */
  .rpt-tabs {
    display:   flex;
    gap:       2px;
    margin-bottom: var(--space-lg);
    border-bottom: 1px solid var(--color-border);
  }

  .rpt-tab-btn {
    background:    none;
    border:        none;
    border-bottom: 3px solid transparent;
    color:         var(--color-text-secondary);
    cursor:        pointer;
    font-family:   var(--font-display);
    font-size:     0.9rem;
    font-weight:   600;
    letter-spacing:0.04em;
    padding:       var(--space-sm) var(--space-lg);
    margin-bottom: -1px;
    transition:    color 0.15s, border-color 0.15s;
  }

  .rpt-tab-btn:hover { color: var(--color-text-primary); }

  .rpt-tab-btn--active {
    color:         var(--color-accent);
    border-bottom: 3px solid var(--color-accent);
  }

  /* ── Controls bar ─────────────────────────────────────────────────── */
  .rpt-controls {
    margin-bottom: var(--space-lg);
  }

  .rpt-controls__row {
    display:     flex;
    align-items: flex-end;
    flex-wrap:   wrap;
    gap:         var(--space-md);
    padding:     var(--space-lg);
  }

  /* ── Report container ─────────────────────────────────────────────── */
  .report-printable {
    background:    var(--color-bg-card);
    border:        1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding:       var(--space-xl) var(--space-2xl);
  }

  /* ── Report header ────────────────────────────────────────────────── */
  .rpt-header {
    display:         flex;
    justify-content: space-between;
    align-items:     flex-start;
    margin-bottom:   var(--space-md);
  }

  .rpt-header__logo {
    height:       40px;
    margin-bottom: var(--space-xs);
    display:      block;
  }

  .rpt-header__company {
    font-family:    var(--font-display);
    font-size:      1.05rem;
    font-weight:    700;
    letter-spacing: 0.06em;
    color:          var(--color-text-primary);
    text-transform: uppercase;
  }

  .rpt-header__right {
    text-align: right;
  }

  .rpt-header__report-title {
    font-family:    var(--font-display);
    font-size:      1.3rem;
    font-weight:    700;
    color:          var(--color-text-primary);
    letter-spacing: 0.04em;
  }

  .rpt-header__subtitle {
    font-size:  0.85rem;
    color:      var(--color-text-secondary);
    margin-top: 2px;
  }

  .rpt-header__generated {
    font-size:  0.75rem;
    color:      var(--color-text-muted);
    margin-top: 4px;
  }

  .rpt-divider {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: var(--space-md) 0 var(--space-lg);
  }

  /* ── Sections ─────────────────────────────────────────────────────── */
  .rpt-section {
    margin-bottom: var(--space-xl);
  }

  .rpt-section__title {
    font-family:    var(--font-display);
    font-size:      0.72rem;
    font-weight:    600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color:          var(--color-text-muted);
    border-bottom:  1px solid var(--color-border);
    padding-bottom: var(--space-xs);
    margin-bottom:  var(--space-md);
  }

  /* ── KPI grid ─────────────────────────────────────────────────────── */
  .rpt-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1px;
    background: var(--color-border);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .rpt-kpi {
    background:     var(--color-bg-card);
    padding:        var(--space-lg) var(--space-md);
    display:        flex;
    flex-direction: column;
    gap:            4px;
  }

  .rpt-kpi__label {
    font-family:    var(--font-display);
    font-size:      0.68rem;
    font-weight:    600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color:          var(--color-text-muted);
  }

  .rpt-kpi__value {
    font-family:    var(--font-display);
    font-size:      1.5rem;
    font-weight:    700;
    color:          var(--color-text-primary);
    line-height:    1.1;
  }

  .rpt-kpi__sub {
    font-size:  0.7rem;
    color:      var(--color-text-muted);
  }

  /* ── Tables ───────────────────────────────────────────────────────── */
  .rpt-table {
    width:           100%;
    border-collapse: collapse;
    font-size:       0.875rem;
  }

  .rpt-table th,
  .rpt-table td {
    padding:      var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--color-border);
    text-align:   left;
  }

  .rpt-table thead th {
    font-family:    var(--font-display);
    font-size:      0.68rem;
    font-weight:    600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color:          var(--color-text-muted);
    background:     var(--color-bg-card-header);
  }

  .rpt-table tfoot th {
    font-family: var(--font-display);
    font-weight: 700;
    background:  var(--color-bg-card-header);
    color:       var(--color-text-primary);
  }

  .rpt-table tbody tr:hover { background: var(--color-bg-hover); }

  .rpt-table--sm th,
  .rpt-table--sm td { padding: 6px var(--space-sm); font-size: 0.82rem; }

  .text-right { text-align: right; }
  .rpt-positive { color: var(--color-success); }
  .rpt-negative { color: var(--color-danger); }

  /* ── Chart ────────────────────────────────────────────────────────── */
  .rpt-chart-section {}

  .rpt-chart-wrap {
    height:   280px;
    position: relative;
  }

  /* ── Footer ───────────────────────────────────────────────────────── */
  .rpt-footer {
    display:         flex;
    justify-content: space-between;
    font-size:       0.72rem;
    color:           var(--color-text-muted);
    border-top:      1px solid var(--color-border);
    padding-top:     var(--space-sm);
    margin-top:      var(--space-xl);
  }

  /* ── Ledger status badges ────────────────────────────────────────── */
  .rpt-status-badge {
    display: inline-block; padding: 2px 8px; border-radius: 3px;
    font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  }
  .rpt-status--paid    { background: var(--color-success-dim); color: var(--color-success); }
  .rpt-status--partial { background: rgba(243,156,18,0.15);    color: var(--color-warning);  }
  .rpt-status--unpaid  { background: var(--color-danger-dim);  color: var(--color-danger);   }

  /* Ledger table — slightly more compact */
  .rpt-table--ledger th,
  .rpt-table--ledger td { padding: 5px var(--space-sm); }

  /* ════════════════════════════════════════════════════════════════
     PRINT STYLES
     Only .report-printable is shown; all app chrome is hidden.
     Background switches to white, text to near-black.
     ════════════════════════════════════════════════════════════════ */
  @media print {

    /* Hide everything */
    body > * { display: none !important; }

    /* Show only the active report */
    #app { display: block !important; }
    .sidebar,
    .module-header,
    .rpt-tabs,
    .rpt-controls,
    #rpt-monthly-print,
    #rpt-sales-print    { display: none !important; }

    .main-content,
    #main-content,
    #view-container,
    #reports-module,
    #rpt-body           { display: block !important; margin: 0 !important; padding: 0 !important; }

    .report-printable {
      display:    block !important;
      background: #ffffff !important;
      color:      #111111 !important;
      border:     none !important;
      padding:    0 !important;
      margin:     0 !important;
      width:      100% !important;
    }

    /* Reset text colours for print */
    .rpt-header__company,
    .rpt-header__report-title { color: #111111 !important; }
    .rpt-header__subtitle,
    .rpt-header__generated,
    .rpt-section__title,
    .rpt-kpi__label,
    .rpt-kpi__sub,
    .rpt-footer,
    .rpt-table thead th { color: #555555 !important; }
    .rpt-kpi__value,
    .rpt-table td,
    .rpt-table tfoot th { color: #111111 !important; }

    /* Backgrounds to white */
    .rpt-kpi,
    .rpt-kpi-grid,
    .rpt-table thead th,
    .rpt-table tfoot th { background: #f5f5f5 !important; }
    .rpt-table tbody tr { background: #ffffff !important; }
    .rpt-kpi-grid       { background: #cccccc !important; }

    /* Keep semantic colours readable in print */
    .rpt-positive { color: #1a7a3f !important; }
    .rpt-negative { color: #b52a1c !important; }
    .rpt-status--paid    { background: #e6f4ec !important; color: #1a7a3f !important; }
    .rpt-status--partial { background: #fef3e2 !important; color: #a05e00 !important; }
    .rpt-status--unpaid  { background: #fce8e6 !important; color: #b52a1c !important; }

    /* Borders to light gray */
    .rpt-divider,
    .rpt-section__title,
    .rpt-table th,
    .rpt-table td,
    .rpt-footer { border-color: #cccccc !important; }

    /* Prevent table rows from splitting across pages */
    .rpt-table tr { page-break-inside: avoid; }

    /* Chart canvas prints as raster image — no special handling needed */

    /* Margins */
    @page {
      margin: 18mm 15mm;
    }
  }

  </style>
  `;
}
