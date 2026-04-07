/**
 * changelog.js — CapFlow Change History Module
 *
 * Displays a full audit log of every create, edit, activate, deactivate,
 * and delete action made in the system.  Data is stored in the Supabase
 * `change_history` table.
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

import { ChangeHistoryAPI } from '../api.js';

// ─── Entry Point ──────────────────────────────────────────────────────────────

export function mountChangelog(container) {
  container.innerHTML = buildModuleHTML();
  attachListeners();
  loadChangelog();
}

// ─── State ────────────────────────────────────────────────────────────────────

let allEntries = [];

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildModuleHTML() {
  return `
    <section class="module" id="changelog-module">

      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">◷</span>
          <div>
            <h1 class="module-header__title">Historial de Cambios</h1>
            <p class="module-header__subtitle">Registro completo de modificaciones en el sistema</p>
          </div>
        </div>
        <div class="module-header__badge" id="changelog-count-badge">— registros</div>
      </header>

      <!-- Filters -->
      <div class="card" id="changelog-filters-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">⊟</span>
            Filtros
          </h2>
          <button class="btn btn--ghost btn--sm" id="changelog-refresh-btn" title="Actualizar">
            ↺ Actualizar
          </button>
        </div>
        <div class="form-grid" style="padding: 0 0 var(--space-md);">
          <div class="form-group">
            <label class="form-label" for="filter-entity-type">Tipo de registro</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="filter-entity-type">
                <option value="">Todos</option>
                <option value="product">Productos</option>
                <option value="machine">Máquinas</option>
                <option value="sale">Ventas</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="filter-action">Acción</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="filter-action">
                <option value="">Todas</option>
                <option value="crear">Crear</option>
                <option value="editar">Editar</option>
                <option value="activar">Activar</option>
                <option value="desactivar">Desactivar</option>
                <option value="eliminar">Eliminar</option>
                <option value="confirmar">Confirmar venta</option>
                <option value="rechazar">Rechazar venta</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="filter-search">Buscar</label>
            <input class="form-input form-input--sm" type="search" id="filter-search"
              placeholder="Buscar por nombre…" aria-label="Buscar en historial">
          </div>
        </div>
      </div>

      <!-- Timeline -->
      <div class="card" id="changelog-list-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Actividad Reciente
          </h2>
        </div>

        <div class="table-loading" id="changelog-loading">
          <div class="spinner"></div>
          <span>Cargando historial…</span>
        </div>

        <div class="table-empty" id="changelog-setup" style="display:none;">
          <span class="table-empty__icon" style="font-size:2.5rem;">⚠</span>
          <p style="font-weight:600;">Tabla no encontrada en Supabase</p>
          <p class="table-empty__sub">
            Ejecuta la migración
            <code style="background:var(--color-surface-raised,#1a2030);padding:2px 6px;border-radius:4px;">
              supabase/migrations/001_create_change_history.sql
            </code>
            en el SQL Editor de Supabase para activar esta función.
          </p>
        </div>

        <div class="table-empty" id="changelog-empty" style="display:none;">
          <span class="table-empty__icon">◷</span>
          <p>Sin registros de cambios aún.</p>
          <p class="table-empty__sub">Los cambios que realices en el sistema aparecerán aquí.</p>
        </div>

        <div id="changelog-timeline" style="display:none;">
          <ul class="changelog-list" id="changelog-list" role="list"></ul>
        </div>
      </div>
    </section>

    <style>
      .changelog-item__user {
        display:       inline-flex;
        align-items:   center;
        gap:           4px;
        font-size:     0.75rem;
        color:         var(--color-text-muted);
        background:    var(--color-bg-base);
        border:        1px solid var(--color-border);
        border-radius: var(--radius-sm, 4px);
        padding:       1px 6px;
        white-space:   nowrap;
      }
      .changelog-item__icon--confirm { background: var(--color-success-bg, #e6f7ee); color: var(--color-success, #27ae60); }
      .changelog-item__icon--reject  { background: var(--color-danger-bg,  #fdecea); color: var(--color-danger,  #e74c3c); }
      .badge--green { background: #27ae6020; color: #27ae60; border-color: #27ae60; }
      .badge--red   { background: #e74c3c20; color: #e74c3c; border-color: #e74c3c; }
    </style>
  `;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadChangelog() {
  showLoading(true);
  try {
    allEntries = await ChangeHistoryAPI.getAll({ limit: 200 });
    applyFilters();
  } catch (err) {
    const isSetupError = err.message?.includes('does not exist') ||
                         err.message?.includes('relation') ||
                         err.message?.includes('42P01');
    showState(isSetupError ? 'setup' : 'empty');
    if (!isSetupError) console.error('[CapFlow Changelog]', err);
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function applyFilters() {
  const entityType = document.getElementById('filter-entity-type')?.value ?? '';
  const action     = document.getElementById('filter-action')?.value ?? '';
  const search     = (document.getElementById('filter-search')?.value ?? '').trim().toLowerCase();

  let results = allEntries;
  if (entityType) results = results.filter(e => e.entity_type === entityType);
  if (action)     results = results.filter(e => e.action === action);
  if (search)     results = results.filter(e =>
    (e.entity_name ?? '').toLowerCase().includes(search)
  );

  updateCountBadge(allEntries.length, results.length !== allEntries.length ? results.length : null);
  renderTimeline(results);
}

function renderTimeline(entries) {
  showLoading(false);
  if (!entries || entries.length === 0) {
    showState(allEntries.length === 0 ? 'empty' : 'filtered-empty');
    return;
  }
  showState('list');
  document.getElementById('changelog-list').innerHTML = entries.map(buildTimelineItem).join('');
}

function buildTimelineItem(entry) {
  const { label, cls, icon } = ACTION_META[entry.action] ?? { label: entry.action, cls: 'edit', icon: '·' };
  const entityLabel = ENTITY_LABELS[entry.entity_type] ?? entry.entity_type;
  const badgeColor  = { create: 'badge--green', edit: 'badge--blue', activate: 'badge--teal',
                        deactivate: 'badge--gray', delete: 'badge--red',
                        confirm: 'badge--green', reject: 'badge--red' }[cls] ?? 'badge--blue';
  const dateStr  = formatDate(entry.created_at);
  const timeStr  = formatTime(entry.created_at);
  const changes  = buildChangesHTML(entry.changes);
  const userName = entry.user_name || entry.operator_name || null;
  const userChip = userName
    ? `<span class="changelog-item__user" title="Registrado por ${escapeHTML(userName)}">👤 ${escapeHTML(userName)}</span>`
    : '';

  return `
    <li class="changelog-item">
      <div class="changelog-item__marker">
        <span class="changelog-item__icon changelog-item__icon--${cls}" aria-hidden="true">${icon}</span>
        <div class="changelog-item__line" aria-hidden="true"></div>
      </div>
      <div class="changelog-item__body">
        <div class="changelog-item__header">
          <span class="badge ${badgeColor}">${label}</span>
          <span class="badge badge--outline">${entityLabel}</span>
          <strong class="changelog-item__name">${escapeHTML(entry.entity_name ?? '—')}</strong>
          ${userChip}
          <span class="changelog-item__time">${escapeHTML(dateStr)} · ${escapeHTML(timeStr)}</span>
        </div>
        ${changes}
      </div>
    </li>
  `;
}

function buildChangesHTML(changes) {
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) return '';

  const rows = Object.entries(changes).map(([field, { before, after }]) => {
    const fl = FIELD_LABELS[field] ?? field;
    return `
      <tr>
        <td class="cl-field">${escapeHTML(fl)}</td>
        <td class="cl-before">${escapeHTML(formatValue(field, before))}</td>
        <td class="cl-arrow" aria-hidden="true">→</td>
        <td class="cl-after">${escapeHTML(formatValue(field, after))}</td>
      </tr>`;
  }).join('');

  return `
    <details class="changelog-item__changes">
      <summary>Ver cambios detallados</summary>
      <table class="cl-diff-table">
        <thead><tr><th>Campo</th><th>Antes</th><th></th><th>Después</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

// ─── Listeners ────────────────────────────────────────────────────────────────

function attachListeners() {
  document.getElementById('changelog-refresh-btn')?.addEventListener('click', loadChangelog);
  document.getElementById('filter-entity-type')?.addEventListener('change', applyFilters);
  document.getElementById('filter-action')?.addEventListener('change', applyFilters);
  document.getElementById('filter-search')?.addEventListener('input', applyFilters);
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function showLoading(on) {
  const el = document.getElementById('changelog-loading');
  if (el) el.style.display = on ? 'flex' : 'none';
}

function showState(state) {
  const map = {
    'changelog-loading':  false,
    'changelog-setup':    state === 'setup',
    'changelog-empty':    state === 'empty' || state === 'filtered-empty',
    'changelog-timeline': state === 'list',
  };
  Object.entries(map).forEach(([id, vis]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = vis ? (id === 'changelog-timeline' ? 'block' : 'flex') : 'none';
  });
}

function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('changelog-count-badge');
  if (!badge) return;
  badge.textContent = filtered !== null
    ? `${filtered} de ${total} registros`
    : `${total} registro${total !== 1 ? 's' : ''}`;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

const ACTION_META = {
  crear:      { label: 'Creado',      cls: 'create',     icon: '＋' },
  editar:     { label: 'Editado',     cls: 'edit',       icon: '✎' },
  activar:    { label: 'Activado',    cls: 'activate',   icon: '✔' },
  desactivar: { label: 'Desactivado', cls: 'deactivate', icon: '✕' },
  eliminar:   { label: 'Eliminado',   cls: 'delete',     icon: '✕' },
  confirmar:  { label: 'Confirmado',  cls: 'confirm',    icon: '✔' },
  rechazar:   { label: 'Rechazado',   cls: 'reject',     icon: '✕' },
};

const ENTITY_LABELS = { product: 'Producto', machine: 'Máquina', sale: 'Venta' };

const FIELD_LABELS = {
  name: 'Nombre', type: 'Tipo', active: 'Estado', isActive: 'Estado',
  code: 'Código', notes: 'Notas',
};

function formatValue(field, value) {
  if (value === null || value === undefined) return '—';
  if (field === 'active' || field === 'isActive')
    return value === true || value === 'true' ? 'Activo' : 'Inactivo';
  if (field === 'type')
    return value === 'manufactured' ? 'Fabricado' : value === 'resale' ? 'Reventa' : value;
  return String(value);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
