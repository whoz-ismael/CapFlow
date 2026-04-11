/**
 * daily-production.js — CapFlow Daily Production Logs Module
 *
 * Shows daily production log entries submitted by CapDispatch operators.
 * Admin can review and confirm each entry (pending_review → confirmed).
 *
 * Data flow:
 *   DailyProductionLogsAPI  ← fetch/confirm entries
 *   DispatchOperatorsAPI    ← operator dropdown
 */

import { DailyProductionLogsAPI } from '../api.js';
import { DispatchOperatorsAPI }   from '../api.js';

// ─── Color definitions (matches CapDispatch) ──────────────────────────────────

const COLORS = [
  { value: 'negro',        label: 'Negro',        dot: '#1f2937' },
  { value: 'blanco',       label: 'Blanco',        dot: '#f9fafb', border: '#d1d5db' },
  { value: 'azul',         label: 'Azul',          dot: '#1d4ed8' },
  { value: 'rojo',         label: 'Rojo',          dot: '#dc2626' },
  { value: 'verde',        label: 'Verde',         dot: '#16a34a' },
  { value: 'amarillo',     label: 'Amarillo',      dot: '#ca8a04' },
  { value: 'naranja',      label: 'Naranja',       dot: '#ea580c' },
  { value: 'marron',       label: 'Marrón',        dot: '#92400e' },
  { value: 'transparente', label: 'Transparente',  dot: '#e5e7eb', border: '#9ca3af' },
  { value: 'rosa',         label: 'Rosa',          dot: '#db2777' },
  { value: 'gris',         label: 'Gris',          dot: '#6b7280' },
  { value: 'morado',       label: 'Morado',        dot: '#7c3aed' },
  { value: 'otro',         label: 'Otro',          dot: '#d1d5db', border: '#9ca3af' },
];

const colorMap = Object.fromEntries(COLORS.map(c => [c.value, c]));

// ─── Module state ─────────────────────────────────────────────────────────────

let allEntries   = [];
let allOperators = [];
let filters      = { status: '', operatorId: '', dateFrom: '', dateTo: '' };
let _container   = null;

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function mountDailyProduction(container) {
  _container = container;
  container.innerHTML = buildModuleHTML();
  attachEventListeners();
  await loadData();
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildModuleHTML() {
  return `
    <div class="module-wrapper" style="padding:1.5rem;max-width:1200px;margin:0 auto;">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:.75rem;">
        <div>
          <h1 style="font-size:1.5rem;font-weight:800;color:#111827;margin:0;">Producción Diaria</h1>
          <p style="color:#6b7280;font-size:.875rem;margin:.25rem 0 0;">Registros enviados por los operarios — confirma para validar</p>
        </div>
        <button id="dp-refresh" style="display:flex;align-items:center;gap:.5rem;background:#7c3aed;color:#fff;border:none;border-radius:.75rem;padding:.5rem 1rem;font-weight:600;cursor:pointer;font-size:.875rem;">
          ↻ Actualizar
        </button>
      </div>

      <!-- Feedback -->
      <div id="dp-feedback" style="display:none;margin-bottom:1rem;"></div>

      <!-- Filters -->
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1rem;padding:1rem;margin-bottom:1rem;">
        <p style="font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:0 0 .75rem;">Filtros</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.75rem;">
          <div>
            <label style="display:block;font-size:.75rem;font-weight:600;color:#374151;margin-bottom:.25rem;">Estado</label>
            <select id="dp-filter-status" style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.375rem .5rem;font-size:.875rem;">
              <option value="">Todos</option>
              <option value="pending_review">Pendientes</option>
              <option value="confirmed">Confirmados</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:.75rem;font-weight:600;color:#374151;margin-bottom:.25rem;">Operario</label>
            <select id="dp-filter-operator" style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.375rem .5rem;font-size:.875rem;">
              <option value="">Todos los operarios</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:.75rem;font-weight:600;color:#374151;margin-bottom:.25rem;">Desde</label>
            <input id="dp-filter-from" type="date" style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.375rem .5rem;font-size:.875rem;box-sizing:border-box;"/>
          </div>
          <div>
            <label style="display:block;font-size:.75rem;font-weight:600;color:#374151;margin-bottom:.25rem;">Hasta</label>
            <input id="dp-filter-to" type="date" style="width:100%;border:1px solid #d1d5db;border-radius:.5rem;padding:.375rem .5rem;font-size:.875rem;box-sizing:border-box;"/>
          </div>
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.75rem;">
          <button id="dp-apply-filters" style="background:#7c3aed;color:#fff;border:none;border-radius:.5rem;padding:.375rem .875rem;font-weight:600;cursor:pointer;font-size:.875rem;">Aplicar filtros</button>
          <button id="dp-clear-filters" style="background:#f3f4f6;color:#374151;border:none;border-radius:.5rem;padding:.375rem .875rem;font-weight:600;cursor:pointer;font-size:.875rem;">Limpiar</button>
        </div>
      </div>

      <!-- Summary -->
      <div id="dp-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1rem;"></div>

      <!-- Table -->
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1rem;overflow:hidden;">
        <div id="dp-count-bar" style="padding:.75rem 1rem;border-bottom:1px solid #f3f4f6;font-size:.875rem;color:#6b7280;"></div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.875rem;">
            <thead>
              <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                <th style="text-align:left;padding:.75rem 1rem;font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Fecha</th>
                <th style="text-align:left;padding:.75rem 1rem;font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Operario</th>
                <th style="text-align:left;padding:.75rem 1rem;font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Color</th>
                <th style="text-align:right;padding:.75rem 1rem;font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Cantidad</th>
                <th style="text-align:left;padding:.75rem 1rem;font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Notas</th>
                <th style="text-align:center;padding:.75rem 1rem;font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Estado</th>
                <th style="text-align:center;padding:.75rem 1rem;font-size:.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Acción</th>
              </tr>
            </thead>
            <tbody id="dp-tbody">
              <tr><td colspan="7" style="text-align:center;padding:3rem;color:#9ca3af;">Cargando...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;
}

// ─── Event listeners ──────────────────────────────────────────────────────────

function attachEventListeners() {
  _container.querySelector('#dp-refresh').addEventListener('click', loadData);
  _container.querySelector('#dp-apply-filters').addEventListener('click', applyFilters);
  _container.querySelector('#dp-clear-filters').addEventListener('click', clearFilters);
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData() {
  try {
    showFeedback('', '');
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

// ─── Table rendering ──────────────────────────────────────────────────────────

function renderTable(entries) {
  const tbody = _container.querySelector('#dp-tbody');
  if (!entries || entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:3rem;color:#9ca3af;">Sin registros</td></tr>`;
    return;
  }
  tbody.innerHTML = entries.map(buildTableRow).join('');

  tbody.querySelectorAll('.dp-confirm-btn').forEach(btn => {
    btn.addEventListener('click', () => handleConfirm(btn.dataset.id));
  });
}

function buildTableRow(entry) {
  const c = colorMap[entry.color] || { label: entry.color, dot: '#d1d5db' };
  const date = new Date(entry.production_date + 'T12:00:00');
  const dateStr = date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });

  const statusBadge = entry.status === 'confirmed'
    ? `<span style="display:inline-flex;align-items:center;gap:.25rem;background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;border-radius:9999px;padding:.125rem .625rem;font-size:.75rem;font-weight:700;">✓ Confirmado</span>`
    : `<span style="display:inline-flex;align-items:center;gap:.25rem;background:#fef9c3;color:#92400e;border:1px solid #fde047;border-radius:9999px;padding:.125rem .625rem;font-size:.75rem;font-weight:700;">⏳ Pendiente</span>`;

  const actionBtn = entry.status === 'pending_review'
    ? `<button class="dp-confirm-btn" data-id="${entry.id}"
         style="background:#7c3aed;color:#fff;border:none;border-radius:.5rem;padding:.25rem .75rem;font-weight:600;cursor:pointer;font-size:.8rem;white-space:nowrap;">
         Confirmar
       </button>`
    : `<span style="color:#9ca3af;font-size:.8rem;">—</span>`;

  return `
    <tr style="border-bottom:1px solid #f3f4f6;" data-entry-id="${entry.id}">
      <td style="padding:.75rem 1rem;color:#111827;white-space:nowrap;">${dateStr}</td>
      <td style="padding:.75rem 1rem;color:#374151;font-weight:500;">${entry.operator_name}</td>
      <td style="padding:.75rem 1rem;">
        <span style="display:inline-flex;align-items:center;gap:.375rem;">
          <span style="width:.75rem;height:.75rem;border-radius:50%;background:${c.dot};border:1px solid ${c.border || c.dot};flex-shrink:0;display:inline-block;"></span>
          <span style="color:#374151;">${c.label}</span>
        </span>
      </td>
      <td style="padding:.75rem 1rem;text-align:right;font-weight:700;color:#111827;">${entry.quantity.toLocaleString('es-DO')}</td>
      <td style="padding:.75rem 1rem;color:#6b7280;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.notes || '—'}</td>
      <td style="padding:.75rem 1rem;text-align:center;">${statusBadge}</td>
      <td style="padding:.75rem 1rem;text-align:center;">${actionBtn}</td>
    </tr>`;
}

// ─── Confirm action ───────────────────────────────────────────────────────────

async function handleConfirm(id) {
  const btn = _container.querySelector(`.dp-confirm-btn[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const updated = await DailyProductionLogsAPI.confirm(id);
    const idx = allEntries.findIndex(e => e.id === id);
    if (idx !== -1) allEntries[idx] = updated;

    const row = _container.querySelector(`tr[data-entry-id="${id}"]`);
    if (row) row.outerHTML = buildTableRow(updated);

    _container.querySelector('#dp-tbody').querySelectorAll('.dp-confirm-btn').forEach(b => {
      b.addEventListener('click', () => handleConfirm(b.dataset.id));
    });

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

  const card = (label, value, color) => `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:.875rem 1rem;">
      <p style="font-size:.75rem;font-weight:600;color:#6b7280;text-transform:uppercase;margin:0 0 .25rem;">${label}</p>
      <p style="font-size:1.5rem;font-weight:800;color:${color};margin:0;">${value.toLocaleString('es-DO')}</p>
    </div>`;

  _container.querySelector('#dp-summary').innerHTML =
    card('Total tapas', total, '#111827') +
    card('Confirmadas', confirmed, '#065f46') +
    card('Pendientes', pending, '#92400e');
}

function updateCountBar(count) {
  const el = _container.querySelector('#dp-count-bar');
  if (el) el.textContent = `${count} registro${count !== 1 ? 's' : ''}`;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function showFeedback(message, type) {
  const el = _container.querySelector('#dp-feedback');
  if (!el) return;
  if (!message) { el.style.display = 'none'; return; }
  const colors = {
    success: { bg: '#d1fae5', border: '#6ee7b7', text: '#065f46' },
    error:   { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
  }[type] || { bg: '#f3f4f6', border: '#e5e7eb', text: '#374151' };
  el.style.cssText = `display:block;padding:.75rem 1rem;border-radius:.75rem;background:${colors.bg};border:1px solid ${colors.border};color:${colors.text};font-size:.875rem;font-weight:500;`;
  el.textContent = message;
}
