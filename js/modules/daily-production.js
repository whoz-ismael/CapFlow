/**
 * daily-production.js — Tapas Diarias (CapFlow)
 *
 * Muestra los registros de tapas enviados por los operarios de CapDispatch.
 * El admin puede confirmar cada entrada (pending_review → confirmed).
 */

import { DailyProductionLogsAPI } from '../api.js';
import { DispatchOperatorsAPI }   from '../api.js';

// ─── Color map (matches CapDispatch constraint) ────────────────────────────────

const COLORS = [
  { value: 'negro',        label: 'Negro',        dot: '#374151' },
  { value: 'blanco',       label: 'Blanco',        dot: '#e5e7eb' },
  { value: 'azul',         label: 'Azul',          dot: '#3b82f6' },
  { value: 'rojo',         label: 'Rojo',          dot: '#ef4444' },
  { value: 'verde',        label: 'Verde',         dot: '#22c55e' },
  { value: 'amarillo',     label: 'Amarillo',      dot: '#eab308' },
  { value: 'naranja',      label: 'Naranja',       dot: '#f97316' },
  { value: 'marron',       label: 'Marrón',        dot: '#92400e' },
  { value: 'transparente', label: 'Transparente',  dot: '#4a556b' },
  { value: 'rosa',         label: 'Rosa',          dot: '#ec4899' },
  { value: 'gris',         label: 'Gris',          dot: '#6b7280' },
  { value: 'morado',       label: 'Morado',        dot: '#8b5cf6' },
  { value: 'otro',         label: 'Otro',          dot: '#4a556b' },
];

const colorMap = Object.fromEntries(COLORS.map(c => [c.value, c]));

// ─── Module state ─────────────────────────────────────────────────────────────

let allEntries   = [];
let allOperators = [];
let filters      = { status: '', operatorId: '', dateFrom: '', dateTo: '' };
let _container   = null;

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function mountDailyProduction(container) {
  _container = container;
  container.innerHTML = buildModuleHTML();
  attachEventListeners();
  await loadData();
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildModuleHTML() {
  return `
    <section class="module" id="daily-production-module">

      <!-- Header -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">✦</span>
          <div>
            <h1 class="module-header__title">Tapas Diarias</h1>
            <p class="module-header__subtitle">Registros enviados por los operarios — confirma para validar</p>
          </div>
        </div>
        <button class="btn btn--primary btn--sm" id="dp-refresh">↻ Actualizar</button>
      </header>

      <!-- Feedback -->
      <div id="dp-feedback" style="display:none;" class="dp-feedback"></div>

      <!-- Summary cards -->
      <div id="dp-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-md);"></div>

      <!-- Filters card -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title"><span class="card__title-icon">▤</span> Filtros</h2>
          <button class="btn btn--ghost btn--xs" id="dp-clear-filters">Limpiar</button>
        </div>
        <div style="padding:var(--space-md);display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-md);">
          <div class="form-group">
            <label class="form-label">Estado</label>
            <div class="select-wrapper">
              <select id="dp-filter-status" class="form-input form-select">
                <option value="">Todos</option>
                <option value="pending_review">Pendientes</option>
                <option value="confirmed">Confirmados</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Operario</label>
            <div class="select-wrapper">
              <select id="dp-filter-operator" class="form-input form-select">
                <option value="">Todos los operarios</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Desde</label>
            <input id="dp-filter-from" type="date" class="form-input"/>
          </div>
          <div class="form-group">
            <label class="form-label">Hasta</label>
            <input id="dp-filter-to" type="date" class="form-input"/>
          </div>
        </div>
        <div style="padding:0 var(--space-md) var(--space-md);display:flex;gap:var(--space-sm);">
          <button class="btn btn--primary btn--sm" id="dp-apply-filters">Aplicar filtros</button>
        </div>
      </div>

      <!-- Table card -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title"><span class="card__title-icon">◈</span> Registros de Tapas</h2>
          <span class="module-header__badge" id="dp-count-bar">— registros</span>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
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
            <tbody id="dp-tbody">
              <tr><td colspan="7" class="table-empty"><span>Cargando...</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </section>
  `;
}

// ─── Event listeners ──────────────────────────────────────────────────────────

function attachEventListeners() {
  _container.querySelector('#dp-refresh').addEventListener('click', loadData);
  _container.querySelector('#dp-apply-filters').addEventListener('click', applyFilters);
  _container.querySelector('#dp-clear-filters').addEventListener('click', clearFilters);
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadData() {
  try {
    hideFeedback();
    [allEntries, allOperators] = await Promise.all([
      DailyProductionLogsAPI.getAll(filters),
      DispatchOperatorsAPI.getAll().catch(() => []),
    ]);
    populateOperatorDropdown();
    renderTable(allEntries);
    renderSummary(allEntries);
    updateCountBar(allEntries.length);
  } catch (err) {
    showFeedback('Error al cargar los registros: ' + err.message, 'error');
    renderTable([]);
  }
}

function populateOperatorDropdown() {
  const sel = _container.querySelector('#dp-filter-operator');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos los operarios</option>';
  allOperators.forEach(op => {
    const opt = document.createElement('option');
    opt.value = op.id;
    opt.textContent = op.name;
    if (op.id === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ─── Filters ──────────────────────────────────────────────────────────────────

async function applyFilters() {
  filters.status     = _container.querySelector('#dp-filter-status').value;
  filters.operatorId = _container.querySelector('#dp-filter-operator').value;
  filters.dateFrom   = _container.querySelector('#dp-filter-from').value;
  filters.dateTo     = _container.querySelector('#dp-filter-to').value;
  await loadData();
}

function clearFilters() {
  filters = { status: '', operatorId: '', dateFrom: '', dateTo: '' };
  _container.querySelector('#dp-filter-status').value   = '';
  _container.querySelector('#dp-filter-operator').value = '';
  _container.querySelector('#dp-filter-from').value     = '';
  _container.querySelector('#dp-filter-to').value       = '';
  loadData();
}

// ─── Table ────────────────────────────────────────────────────────────────────

function renderTable(entries) {
  const tbody = _container.querySelector('#dp-tbody');
  if (!entries || entries.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="table-empty">
          <span class="table-empty__icon">✦</span>
          <span>Sin registros</span>
          <span class="table-empty__sub">Ajusta los filtros o espera nuevos envíos de los operarios</span>
        </div>
      </td></tr>`;
    return;
  }
  tbody.innerHTML = entries.map(buildTableRow).join('');
  tbody.querySelectorAll('.dp-confirm-btn').forEach(btn => {
    btn.addEventListener('click', () => handleConfirm(btn.dataset.id));
  });
}

function buildTableRow(entry) {
  const c = colorMap[entry.color] || { label: entry.color, dot: '#4a556b' };
  const date = new Date(entry.production_date + 'T12:00:00');
  const dateStr = date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });

  const statusBadge = entry.status === 'confirmed'
    ? `<span class="badge badge--green">✓ Confirmado</span>`
    : `<span class="badge badge--warning">⏳ Pendiente</span>`;

  const actionBtn = entry.status === 'pending_review'
    ? `<button class="btn btn--primary btn--xs dp-confirm-btn" data-id="${entry.id}">Confirmar</button>`
    : `<span style="color:var(--color-text-muted);font-size:.8rem;">—</span>`;

  return `
    <tr class="table-row" data-entry-id="${entry.id}">
      <td style="white-space:nowrap;font-family:var(--font-mono);font-size:.82rem;color:var(--color-text-secondary);">${dateStr}</td>
      <td style="font-weight:500;">${entry.operator_name}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:.4rem;">
          <span style="width:.625rem;height:.625rem;border-radius:50%;background:${c.dot};flex-shrink:0;display:inline-block;border:1px solid rgba(255,255,255,.15);"></span>
          ${c.label}
        </span>
      </td>
      <td class="text-right" style="font-family:var(--font-mono);font-weight:600;">${entry.quantity.toLocaleString('es-DO')}</td>
      <td style="color:var(--color-text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.notes || '—'}</td>
      <td class="text-center">${statusBadge}</td>
      <td class="text-center td-actions">${actionBtn}</td>
    </tr>`;
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

async function handleConfirm(id) {
  const btn = _container.querySelector(`.dp-confirm-btn[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const updated = await DailyProductionLogsAPI.confirm(id);
    const idx = allEntries.findIndex(e => e.id === id);
    if (idx !== -1) allEntries[idx] = updated;

    const row = _container.querySelector(`tr[data-entry-id="${id}"]`);
    if (row) {
      row.outerHTML = buildTableRow(updated);
      _container.querySelector('#dp-tbody').querySelectorAll('.dp-confirm-btn').forEach(b => {
        b.addEventListener('click', () => handleConfirm(b.dataset.id));
      });
    }
    renderSummary(allEntries);
    showFeedback('Registro confirmado correctamente.', 'success');
  } catch (err) {
    showFeedback('Error al confirmar: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar'; }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function renderSummary(entries) {
  const total     = entries.reduce((s, e) => s + e.quantity, 0);
  const confirmed = entries.filter(e => e.status === 'confirmed').reduce((s, e) => s + e.quantity, 0);
  const pending   = entries.filter(e => e.status === 'pending_review').reduce((s, e) => s + e.quantity, 0);

  const card = (label, value, badgeClass) => `
    <div class="card" style="padding:var(--space-md) var(--space-lg);">
      <p style="font-family:var(--font-display);font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted);margin:0 0 .375rem;">${label}</p>
      <p style="font-family:var(--font-mono);font-size:1.75rem;font-weight:700;color:var(--color-text-primary);margin:0;">${value.toLocaleString('es-DO')}</p>
    </div>`;

  _container.querySelector('#dp-summary').innerHTML =
    card('Total tapas',   total,     '') +
    card('Confirmadas',   confirmed, 'badge--green') +
    card('Pendientes',    pending,   'badge--warning');
}

function updateCountBar(count) {
  const el = _container.querySelector('#dp-count-bar');
  if (el) el.textContent = `${count} registro${count !== 1 ? 's' : ''}`;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function showFeedback(message, type) {
  const el = _container.querySelector('#dp-feedback');
  if (!el) return;
  const styles = {
    success: 'background:var(--color-success-dim);border:1px solid rgba(46,204,113,.3);color:var(--color-success);',
    error:   'background:var(--color-danger-dim);border:1px solid rgba(231,76,60,.3);color:var(--color-danger);',
  }[type] || '';
  el.style.cssText = `display:block;padding:.75rem 1rem;border-radius:var(--radius-md);font-size:.875rem;font-weight:500;${styles}`;
  el.textContent = message;
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function hideFeedback() {
  const el = _container.querySelector('#dp-feedback');
  if (el) el.style.display = 'none';
}
