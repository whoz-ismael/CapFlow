/**
 * tapas_diarias.js — CapFlow: Tapas Diarias Module
 *
 * Displays daily cap production records logged by operators in CapDispatch.
 * Reads from the shared `daily_production_logs` Supabase table.
 * Supervisors can confirm pending records from this view.
 */

import { DailyProductionAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

let allEntries   = [];
let activeMonth  = getCurrentMonth();
let activeStatus = 'all';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showFeedback(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3500);
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildModuleHTML() {
  return `
    <section class="module">
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">▦</span>
          <div>
            <h1 class="module-header__title">Tapas Diarias</h1>
            <p class="module-header__subtitle">Producción registrada desde CapDispatch</p>
          </div>
        </div>
        <div class="module-header__right">
          <span class="badge badge--neutral" id="entries-count">— registros</span>
        </div>
      </header>

      <!-- Filters -->
      <div class="card" style="margin-bottom: var(--space-md);">
        <div style="display: flex; gap: var(--space-md); flex-wrap: wrap; align-items: center;">
          <div>
            <label class="form__label" for="filter-month">Mes</label>
            <input
              type="month"
              id="filter-month"
              class="form__input"
              value="${activeMonth}"
              style="width: 160px;"
            />
          </div>
          <div>
            <label class="form__label" for="filter-status">Estado</label>
            <select id="filter-status" class="form__select" style="width: 160px;">
              <option value="all"            ${activeStatus === 'all'             ? 'selected' : ''}>Todos</option>
              <option value="pending_review" ${activeStatus === 'pending_review'  ? 'selected' : ''}>Pendiente</option>
              <option value="confirmed"      ${activeStatus === 'confirmed'       ? 'selected' : ''}>Confirmado</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Table card -->
      <div class="card">
        <div class="table-wrapper">
          <table class="table" id="entries-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Operario</th>
                <th>Producto</th>
                <th style="text-align:right;">Cantidad</th>
                <th>Estado</th>
                <th>Notas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="entries-tbody">
              <tr>
                <td colspan="7" class="table__empty">
                  <div class="spinner" style="margin: 0 auto;"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

function renderTableLoading() {
  const tbody = document.getElementById('entries-tbody');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="table__empty">
        <div class="spinner" style="margin: 0 auto;"></div>
      </td>
    </tr>
  `;
}

function renderTable(entries) {
  const tbody = document.getElementById('entries-tbody');
  const countEl = document.getElementById('entries-count');
  if (!tbody) return;

  if (countEl) {
    countEl.textContent = `${entries.length} registro${entries.length !== 1 ? 's' : ''}`;
  }

  if (entries.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table__empty">Sin registros para los filtros seleccionados.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = entries.map(entry => buildTableRow(entry)).join('');

  // Attach confirm button listeners
  tbody.querySelectorAll('.btn-confirm').forEach(btn => {
    btn.addEventListener('click', () => handleConfirm(btn.dataset.id));
  });
}

function buildTableRow(entry) {
  const isPending = entry.status === 'pending_review';

  const statusBadge = isPending
    ? `<span class="badge badge--warning">Pendiente</span>`
    : `<span class="badge badge--success">Confirmado</span>`;

  const confirmBtn = isPending
    ? `<button class="btn btn--sm btn--primary btn-confirm" data-id="${escapeHTML(entry.id)}">
         Confirmar
       </button>`
    : `<span style="color: var(--color-text-muted); font-size: 0.8rem;">—</span>`;

  const qty = typeof entry.quantity === 'number'
    ? entry.quantity.toLocaleString('es-DO')
    : escapeHTML(entry.quantity);

  return `
    <tr data-id="${escapeHTML(entry.id)}">
      <td>${escapeHTML(formatDate(entry.production_date))}</td>
      <td>${escapeHTML(entry.operator_name ?? '—')}</td>
      <td>${escapeHTML(entry.color ?? '—')}</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${qty}</td>
      <td>${statusBadge}</td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(entry.notes ?? '')}">
        ${escapeHTML(entry.notes ?? '—')}
      </td>
      <td>${confirmBtn}</td>
    </tr>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadEntries() {
  renderTableLoading();

  try {
    const filters = {};
    if (activeMonth)               filters.month  = activeMonth;
    if (activeStatus !== 'all')    filters.status = activeStatus;

    allEntries = await DailyProductionAPI.getAll(filters);
    renderTable(allEntries);
  } catch (err) {
    const tbody = document.getElementById('entries-tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="table__empty" style="color: var(--color-danger);">
            Error cargando registros: ${escapeHTML(err.message)}
          </td>
        </tr>
      `;
    }
    console.error('[TapasDiarias] Error loading entries:', err);
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function handleConfirm(id) {
  const btn = document.querySelector(`.btn-confirm[data-id="${id}"]`);
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = 'Confirmando…';

  try {
    await DailyProductionAPI.confirm(id);
    showFeedback('Registro confirmado correctamente.', 'success');
    await loadEntries();
  } catch (err) {
    showFeedback(`Error al confirmar: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Confirmar';
    console.error('[TapasDiarias] Confirm error:', err);
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export function mountTapasDiarias(container) {
  container.innerHTML = buildModuleHTML();

  // Month filter
  const monthInput = document.getElementById('filter-month');
  if (monthInput) {
    monthInput.addEventListener('change', () => {
      activeMonth = monthInput.value || '';
      loadEntries();
    });
  }

  // Status filter
  const statusSelect = document.getElementById('filter-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      activeStatus = statusSelect.value;
      loadEntries();
    });
  }

  loadEntries();
}
