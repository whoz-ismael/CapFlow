/**
 * production.js — CapFlow Production Module
 *
 * Displays daily production log entries submitted by operators via CapDispatch.
 * Managers can review entries (pending_review) and confirm them (confirmed).
 *
 * Data source: Supabase table `daily_production_logs`
 * Status flow:  pending_review → confirmed
 */

import { DailyProductionLogsAPI, DispatchOperatorsAPI } from '../api.js';

// ─── Color Catalog ────────────────────────────────────────────────────────────
// Must match the enum in daily_production_logs and CapDispatch's PRODUCTION_COLORS

const COLORS = [
  { value: 'negro',        label: 'Negro',        dot: '#1f2937' },
  { value: 'blanco',       label: 'Blanco',       dot: '#e5e7eb' },
  { value: 'azul',         label: 'Azul',         dot: '#3b82f6' },
  { value: 'rojo',         label: 'Rojo',         dot: '#ef4444' },
  { value: 'verde',        label: 'Verde',        dot: '#22c55e' },
  { value: 'amarillo',     label: 'Amarillo',     dot: '#eab308' },
  { value: 'naranja',      label: 'Naranja',      dot: '#f97316' },
  { value: 'marron',       label: 'Marrón',       dot: '#92400e' },
  { value: 'transparente', label: 'Transparente', dot: '#bfdbfe' },
  { value: 'rosa',         label: 'Rosa',         dot: '#ec4899' },
  { value: 'gris',         label: 'Gris',         dot: '#9ca3af' },
  { value: 'morado',       label: 'Morado',       dot: '#8b5cf6' },
  { value: 'otro',         label: 'Otro',         dot: '#d1d5db' },
];

function colorLabel(value) {
  return COLORS.find(c => c.value === value)?.label ?? value;
}

function colorDot(value) {
  const color = COLORS.find(c => c.value === value);
  return color
    ? `display:inline-block;width:12px;height:12px;border-radius:50%;background:${color.dot};border:1px solid #e5e7eb;vertical-align:middle;margin-right:6px;`
    : '';
}

// ─── Module State ─────────────────────────────────────────────────────────────

let allEntries   = [];
let allOperators = [];
let filters      = { status: '', operatorId: '', dateFrom: '', dateTo: '' };

// ─── Entry Point ──────────────────────────────────────────────────────────────

export function mountProduction(container) {
  container.innerHTML = buildModuleHTML();
  attachEventListeners();
  loadData();
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildModuleHTML() {
  return `
    <section class="module" id="production-module">

      <!-- Page Header -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">⬡</span>
          <div>
            <h1 class="module-header__title">Producción Diaria</h1>
            <p class="module-header__subtitle">Registros enviados por los operarios — confirma para validar</p>
          </div>
        </div>
        <div class="module-header__badge" id="production-count-badge">— registros</div>
      </header>

      <!-- Filters Card -->
      <div class="card" id="filters-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">⊟</span>
            Filtros
          </h2>
        </div>
        <div class="form-grid">

          <!-- Estado -->
          <div class="form-group">
            <label class="form-label" for="filter-status">Estado</label>
            <div class="select-wrapper">
              <select class="form-input form-select" id="filter-status">
                <option value="">Todos</option>
                <option value="pending_review">Pendiente</option>
                <option value="confirmed">Confirmado</option>
              </select>
            </div>
          </div>

          <!-- Operario -->
          <div class="form-group">
            <label class="form-label" for="filter-operator">Operario</label>
            <div class="select-wrapper">
              <select class="form-input form-select" id="filter-operator">
                <option value="">Todos los operarios</option>
              </select>
            </div>
          </div>

          <!-- Fecha desde -->
          <div class="form-group">
            <label class="form-label" for="filter-date-from">Desde</label>
            <input class="form-input" type="date" id="filter-date-from">
          </div>

          <!-- Fecha hasta -->
          <div class="form-group">
            <label class="form-label" for="filter-date-to">Hasta</label>
            <input class="form-input" type="date" id="filter-date-to">
          </div>

        </div>
        <div class="form-actions">
          <button class="btn btn--primary" id="apply-filters-btn">
            <span class="btn__icon">⊞</span>
            Aplicar filtros
          </button>
          <button class="btn btn--ghost" id="clear-filters-btn">
            Limpiar
          </button>
        </div>
      </div>

      <!-- Feedback Banner -->
      <div class="feedback-banner" id="feedback-banner" role="alert" aria-live="polite"></div>

      <!-- Summary Card -->
      <div class="card" id="summary-card" style="display:none;">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">◎</span>
            Resumen
          </h2>
        </div>
        <div id="summary-content"></div>
      </div>

      <!-- Table Card -->
      <div class="card" id="production-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Registros de Producción
          </h2>
          <div class="table-controls">
            <input
              class="form-input form-input--sm"
              type="search"
              id="table-search"
              placeholder="Buscar operario…"
              aria-label="Buscar operario"
            >
          </div>
        </div>

        <!-- Loading -->
        <div class="table-loading" id="table-loading">
          <div class="spinner"></div>
          <span>Cargando registros…</span>
        </div>

        <!-- Empty -->
        <div class="table-empty" id="table-empty" style="display:none;">
          <span class="table-empty__icon">📦</span>
          <p>No hay registros con los filtros seleccionados.</p>
        </div>

        <!-- Table -->
        <div class="table-wrapper" id="table-wrapper" style="display:none;">
          <table class="data-table" id="production-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Operario</th>
                <th>Color</th>
                <th class="text-right">Cantidad</th>
                <th>Notas</th>
                <th class="text-center">Estado</th>
                <th class="text-center">Acción</th>
              </tr>
            </thead>
            <tbody id="production-tbody"></tbody>
          </table>
        </div>
      </div>

    </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
  showTableLoading(true);

  try {
    // Load operators for the filter dropdown (fire-and-forget on error)
    DispatchOperatorsAPI.getAll()
      .then(ops => {
        allOperators = ops;
        populateOperatorDropdown(ops);
      })
      .catch(() => {}); // operator dropdown is optional

    // Load entries with current filters
    allEntries = await DailyProductionLogsAPI.getAll({
      status:     filters.status     || undefined,
      operatorId: filters.operatorId || undefined,
      dateFrom:   filters.dateFrom   || undefined,
      dateTo:     filters.dateTo     || undefined,
    });

    renderTable(allEntries);
    updateCountBadge(allEntries.length);
    renderSummary(allEntries);

  } catch (err) {
    showFeedback(`Error al cargar registros: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

function populateOperatorDropdown(operators) {
  const select = document.getElementById('filter-operator');
  if (!select) return;

  // Keep the "All" option, append operators
  operators.forEach(op => {
    const option = document.createElement('option');
    option.value       = op.id;
    option.textContent = op.name;
    select.appendChild(option);
  });

  // Restore selected value if filters are active
  if (filters.operatorId) select.value = filters.operatorId;
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

function renderTable(entries) {
  showTableLoading(false);

  const tbody   = document.getElementById('production-tbody');
  const empty   = document.getElementById('table-empty');
  const wrapper = document.getElementById('table-wrapper');

  if (!entries || entries.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = entries.map(buildTableRow).join('');

  tbody.querySelectorAll('[data-action="confirm"]').forEach(btn => {
    btn.addEventListener('click', () => handleConfirm(btn.dataset.id));
  });
}

function buildTableRow(entry) {
  const dateFormatted = formatDate(entry.production_date);
  const isPending     = entry.status === 'pending_review';
  const statusLabel   = isPending ? 'Pendiente' : 'Confirmado';
  const statusClass   = isPending ? 'badge--yellow' : 'badge--green';
  const qty           = Number(entry.quantity).toLocaleString('es-DO');
  const notes         = escapeHTML(entry.notes || '—');

  return `
    <tr class="table-row">
      <td class="td-date">${dateFormatted}</td>
      <td class="td-operator">${escapeHTML(entry.operator_name)}</td>
      <td>
        <span style="${colorDot(entry.color)}"></span>
        ${escapeHTML(colorLabel(entry.color))}
      </td>
      <td class="text-right td-qty">${qty}</td>
      <td class="td-notes" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHTML(entry.notes || '')}">${notes}</td>
      <td class="text-center">
        <span class="badge ${statusClass}">${statusLabel}</span>
      </td>
      <td class="text-center td-actions">
        ${isPending
          ? `<button
               class="btn btn--success-ghost btn--xs"
               data-action="confirm"
               data-id="${entry.id}"
               title="Confirmar registro">
               ✔ Confirmar
             </button>`
          : `<span style="color:var(--color-text-muted);font-size:0.75rem;">—</span>`
        }
      </td>
    </tr>
  `;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function renderSummary(entries) {
  const summaryCard    = document.getElementById('summary-card');
  const summaryContent = document.getElementById('summary-content');
  if (!summaryCard || !summaryContent || !entries.length) {
    if (summaryCard) summaryCard.style.display = 'none';
    return;
  }

  summaryCard.style.display = 'block';

  const totalQty    = entries.reduce((s, e) => s + Number(e.quantity), 0);
  const confirmed   = entries.filter(e => e.status === 'confirmed');
  const pending     = entries.filter(e => e.status === 'pending_review');
  const confirmedQty = confirmed.reduce((s, e) => s + Number(e.quantity), 0);
  const pendingQty   = pending.reduce((s, e)   => s + Number(e.quantity), 0);

  // Group by color
  const byColor = {};
  entries.forEach(e => {
    if (!byColor[e.color]) byColor[e.color] = { confirmed: 0, pending: 0 };
    if (e.status === 'confirmed') byColor[e.color].confirmed += Number(e.quantity);
    else                          byColor[e.color].pending   += Number(e.quantity);
  });

  const colorRows = Object.entries(byColor)
    .sort(([, a], [, b]) => (b.confirmed + b.pending) - (a.confirmed + a.pending))
    .map(([color, counts]) => `
      <tr>
        <td>
          <span style="${colorDot(color)}"></span>
          ${escapeHTML(colorLabel(color))}
        </td>
        <td class="text-right">${(counts.confirmed + counts.pending).toLocaleString('es-DO')}</td>
        <td class="text-right">${counts.confirmed.toLocaleString('es-DO')}</td>
        <td class="text-right">${counts.pending.toLocaleString('es-DO')}</td>
      </tr>
    `).join('');

  summaryContent.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-md);margin-bottom:var(--space-lg);">
      <div style="text-align:center;padding:var(--space-md);background:var(--color-bg-subtle);border-radius:var(--radius-md);">
        <p style="font-size:1.5rem;font-weight:700;color:var(--color-text);">${totalQty.toLocaleString('es-DO')}</p>
        <p style="font-size:0.75rem;color:var(--color-text-muted);">Total tapas</p>
      </div>
      <div style="text-align:center;padding:var(--space-md);background:#f0fdf4;border-radius:var(--radius-md);">
        <p style="font-size:1.5rem;font-weight:700;color:#15803d;">${confirmedQty.toLocaleString('es-DO')}</p>
        <p style="font-size:0.75rem;color:#15803d;">Confirmadas</p>
      </div>
      <div style="text-align:center;padding:var(--space-md);background:#fefce8;border-radius:var(--radius-md);">
        <p style="font-size:1.5rem;font-weight:700;color:#a16207;">${pendingQty.toLocaleString('es-DO')}</p>
        <p style="font-size:0.75rem;color:#a16207;">Pendientes</p>
      </div>
    </div>
    <div class="table-wrapper">
      <table class="data-table" style="margin:0;">
        <thead>
          <tr>
            <th>Color</th>
            <th class="text-right">Total</th>
            <th class="text-right">Confirmadas</th>
            <th class="text-right">Pendientes</th>
          </tr>
        </thead>
        <tbody>${colorRows}</tbody>
      </table>
    </div>
  `;
}

// ─── Confirm Action ───────────────────────────────────────────────────────────

async function handleConfirm(entryId) {
  const btn = document.querySelector(`[data-action="confirm"][data-id="${entryId}"]`);
  if (btn) {
    btn.disabled     = true;
    btn.textContent  = 'Confirmando…';
  }

  try {
    await DailyProductionLogsAPI.confirm(entryId);

    // Optimistic update: update in-memory array, re-render
    const idx = allEntries.findIndex(e => e.id === entryId);
    if (idx !== -1) {
      allEntries[idx] = {
        ...allEntries[idx],
        status:      'confirmed',
        confirmed_at: new Date().toISOString(),
      };
    }

    // Apply current search filter and re-render
    const searchVal = document.getElementById('table-search')?.value?.trim()?.toLowerCase() ?? '';
    const visible   = searchVal
      ? allEntries.filter(e => e.operator_name.toLowerCase().includes(searchVal))
      : allEntries;

    renderTable(visible);
    renderSummary(allEntries);
    showFeedback('Registro confirmado correctamente.', 'success');

  } catch (err) {
    showFeedback(`Error al confirmar: ${err.message}`, 'error');
    if (btn) {
      btn.disabled    = false;
      btn.textContent = '✔ Confirmar';
    }
  }
}

// ─── Filters & Search ─────────────────────────────────────────────────────────

function attachEventListeners() {
  document.getElementById('apply-filters-btn')
    ?.addEventListener('click', handleApplyFilters);

  document.getElementById('clear-filters-btn')
    ?.addEventListener('click', handleClearFilters);

  document.getElementById('table-search')
    ?.addEventListener('input', handleSearch);
}

function handleApplyFilters() {
  filters.status     = document.getElementById('filter-status')?.value     ?? '';
  filters.operatorId = document.getElementById('filter-operator')?.value   ?? '';
  filters.dateFrom   = document.getElementById('filter-date-from')?.value  ?? '';
  filters.dateTo     = document.getElementById('filter-date-to')?.value    ?? '';
  loadData();
}

function handleClearFilters() {
  filters = { status: '', operatorId: '', dateFrom: '', dateTo: '' };

  const ids = ['filter-status', 'filter-operator', 'filter-date-from', 'filter-date-to'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  loadData();
}

function handleSearch(e) {
  const query    = e.target.value.trim().toLowerCase();
  const filtered = query
    ? allEntries.filter(e => e.operator_name.toLowerCase().includes(query))
    : allEntries;

  renderTable(filtered);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showTableLoading(loading) {
  const loadingEl = document.getElementById('table-loading');
  const wrapperEl = document.getElementById('table-wrapper');
  const emptyEl   = document.getElementById('table-empty');
  if (loadingEl) loadingEl.style.display = loading ? 'flex' : 'none';
  if (wrapperEl) wrapperEl.style.display = loading ? 'none' : '';
  if (emptyEl)   emptyEl.style.display   = 'none';
}

function showFeedback(message, type = 'success') {
  const banner = document.getElementById('feedback-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.className   = `feedback-banner feedback-banner--${type} feedback-banner--visible`;
  clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => {
    banner.classList.remove('feedback-banner--visible');
  }, 4000);
}

function updateCountBadge(count) {
  const badge = document.getElementById('production-count-badge');
  if (badge) badge.textContent = `${count} registro${count !== 1 ? 's' : ''}`;
}

/**
 * Format an ISO date string (YYYY-MM-DD) to a localized Spanish date.
 * @param {string} isoDate
 * @returns {string}
 */
function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('es-DO', {
    weekday: 'short',
    day:     '2-digit',
    month:   'short',
    year:    'numeric',
  });
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
