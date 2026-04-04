/**
 * changelog.js — CapFlow Change History Module
 *
 * Displays a full audit log of every create, edit, activate, and deactivate
 * action made in the system. Data is stored in the Supabase `change_history`
 * table (see supabase/migrations/001_create_change_history.sql).
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

import { ChangeHistoryAPI } from '../api.js';

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Changelog module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export function mountChangelog(container) {
  container.innerHTML = buildModuleHTML();
  attachListeners();
  loadChangelog();
}

// ─── State ────────────────────────────────────────────────────────────────────

/** All entries loaded from Supabase. */
let allEntries = [];

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildModuleHTML() {
  return `
    <section class="module" id="changelog-module">

      <!-- ── Page Header ── -->
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

      <!-- ── Filters Card ── -->
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

          <!-- Entity type filter -->
          <div class="form-group">
            <label class="form-label" for="filter-entity-type">Tipo de registro</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="filter-entity-type">
                <option value="">Todos</option>
                <option value="product">Productos</option>
                <option value="machine">Máquinas</option>
              </select>
            </div>
          </div>

          <!-- Action filter -->
          <div class="form-group">
            <label class="form-label" for="filter-action">Acción</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="filter-action">
                <option value="">Todas</option>
                <option value="crear">Crear</option>
                <option value="editar">Editar</option>
                <option value="activar">Activar</option>
                <option value="desactivar">Desactivar</option>
              </select>
            </div>
          </div>

          <!-- Text search -->
          <div class="form-group">
            <label class="form-label" for="filter-search">Buscar</label>
            <input
              class="form-input form-input--sm"
              type="search"
              id="filter-search"
              placeholder="Buscar por nombre…"
              aria-label="Buscar en historial"
            >
          </div>

        </div>
      </div>

      <!-- ── Timeline Card ── -->
      <div class="card" id="changelog-list-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Actividad Reciente
          </h2>
        </div>

        <!-- Loading -->
        <div class="table-loading" id="changelog-loading">
          <div class="spinner"></div>
          <span>Cargando historial…</span>
        </div>

        <!-- Setup needed -->
        <div class="table-empty" id="changelog-setup" style="display:none;">
          <span class="table-empty__icon" style="font-size:2.5rem;">⚠</span>
          <p style="font-weight:600;">Tabla no encontrada en Supabase</p>
          <p class="table-empty__sub">
            Ejecuta la migración
            <code style="background:var(--color-surface-raised);padding:2px 6px;border-radius:4px;">
              supabase/migrations/001_create_change_history.sql
            </code>
            en el SQL Editor de Supabase para activar esta función.
          </p>
        </div>

        <!-- Empty -->
        <div class="table-empty" id="changelog-empty" style="display:none;">
          <span class="table-empty__icon">◷</span>
          <p>Sin registros de cambios aún.</p>
          <p class="table-empty__sub">Los cambios que realices en Productos y Máquinas aparecerán aquí.</p>
        </div>

        <!-- Timeline -->
        <div id="changelog-timeline" style="display:none;">
          <ul class="changelog-list" id="changelog-list" role="list"></ul>
        </div>

      </div>
    </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadChangelog() {
  showLoading(true);

  try {
    allEntries = await ChangeHistoryAPI.getAll({ limit: 200 });
    applyFilters();
  } catch (err) {
    // If the table doesn't exist, Supabase returns a specific error
    const isSetupError = err.message?.includes('does not exist') ||
                         err.message?.includes('relation') ||
                         err.message?.includes('42P01');

    if (isSetupError) {
      showState('setup');
    } else {
      showState('empty');
      console.error('[CapFlow Changelog]', err);
    }
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Filter allEntries and re-render the timeline.
 */
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

/**
 * Render the filtered entries as a timeline list.
 * @param {Array} entries
 */
function renderTimeline(entries) {
  showLoading(false);

  if (!entries || entries.length === 0) {
    showState(allEntries.length === 0 ? 'empty' : 'filtered-empty');
    return;
  }

  showState('list');

  const list = document.getElementById('changelog-list');
  list.innerHTML = entries.map(buildTimelineItem).join('');
}

/**
 * Build a single timeline item HTML.
 * @param {Object} entry
 * @returns {string}
 */
function buildTimelineItem(entry) {
  const { actionLabel, actionClass, actionIcon } = getActionMeta(entry.action);
  const entityLabel = getEntityLabel(entry.entity_type);
  const dateStr     = formatDate(entry.created_at);
  const timeStr     = formatTime(entry.created_at);
  const changesHTML = buildChangesHTML(entry.changes);

  return `
    <li class="changelog-item">
      <div class="changelog-item__marker">
        <span class="changelog-item__icon changelog-item__icon--${actionClass}"
              aria-hidden="true">${actionIcon}</span>
        <div class="changelog-item__line" aria-hidden="true"></div>
      </div>
      <div class="changelog-item__body">
        <div class="changelog-item__header">
          <span class="badge ${actionClass === 'create' ? 'badge--green' :
                               actionClass === 'edit'   ? 'badge--blue'  :
                               actionClass === 'activate' ? 'badge--teal' :
                               'badge--gray'}">${actionLabel}</span>
          <span class="badge badge--outline">${entityLabel}</span>
          <strong class="changelog-item__name">${escapeHTML(entry.entity_name ?? '—')}</strong>
          <span class="changelog-item__time" title="${escapeHTML(dateStr)} ${escapeHTML(timeStr)}">
            ${escapeHTML(dateStr)} · ${escapeHTML(timeStr)}
          </span>
        </div>
        ${changesHTML}
      </div>
    </li>
  `;
}

/**
 * Build the "what changed" detail block if changes are present.
 * @param {Object|null} changes
 * @returns {string}
 */
function buildChangesHTML(changes) {
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
    return '';
  }

  const rows = Object.entries(changes).map(([field, { before, after }]) => {
    const fieldLabel = FIELD_LABELS[field] ?? field;
    return `
      <tr>
        <td class="cl-field">${escapeHTML(fieldLabel)}</td>
        <td class="cl-before">${escapeHTML(formatValue(field, before))}</td>
        <td class="cl-arrow" aria-hidden="true">→</td>
        <td class="cl-after">${escapeHTML(formatValue(field, after))}</td>
      </tr>
    `;
  }).join('');

  return `
    <details class="changelog-item__changes">
      <summary>Ver cambios detallados</summary>
      <table class="cl-diff-table">
        <thead>
          <tr>
            <th>Campo</th>
            <th>Antes</th>
            <th></th>
            <th>Después</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </details>
  `;
}

// ─── Listeners ────────────────────────────────────────────────────────────────

function attachListeners() {
  document.getElementById('changelog-refresh-btn')
    ?.addEventListener('click', loadChangelog);

  document.getElementById('filter-entity-type')
    ?.addEventListener('change', applyFilters);

  document.getElementById('filter-action')
    ?.addEventListener('change', applyFilters);

  document.getElementById('filter-search')
    ?.addEventListener('input', applyFilters);
}

// ─── UI State Helpers ─────────────────────────────────────────────────────────

function showLoading(loading) {
  const loadingEl  = document.getElementById('changelog-loading');
  if (loadingEl) loadingEl.style.display = loading ? 'flex' : 'none';
}

/**
 * Show one of the UI states: 'list' | 'empty' | 'setup' | 'filtered-empty'
 */
function showState(state) {
  const ids = {
    'changelog-loading':  false,
    'changelog-setup':    state === 'setup',
    'changelog-empty':    state === 'empty' || state === 'filtered-empty',
    'changelog-timeline': state === 'list',
  };
  Object.entries(ids).forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? (id === 'changelog-timeline' ? 'block' : 'flex') : 'none';
  });
}

function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('changelog-count-badge');
  if (!badge) return;
  if (filtered !== null) {
    badge.textContent = `${filtered} de ${total} registros`;
  } else {
    badge.textContent = `${total} registro${total !== 1 ? 's' : ''}`;
  }
}

// ─── Metadata Helpers ─────────────────────────────────────────────────────────

const ACTION_META = {
  crear:      { actionLabel: 'Creado',      actionClass: 'create',     actionIcon: '＋' },
  editar:     { actionLabel: 'Editado',     actionClass: 'edit',       actionIcon: '✎' },
  activar:    { actionLabel: 'Activado',    actionClass: 'activate',   actionIcon: '✔' },
  desactivar: { actionLabel: 'Desactivado', actionClass: 'deactivate', actionIcon: '✕' },
};

function getActionMeta(action) {
  return ACTION_META[action] ?? { actionLabel: action, actionClass: 'edit', actionIcon: '·' };
}

const ENTITY_LABELS = { product: 'Producto', machine: 'Máquina' };
function getEntityLabel(type) {
  return ENTITY_LABELS[type] ?? type;
}

/** Human-readable field names for the diff table. */
const FIELD_LABELS = {
  name:          'Nombre',
  type:          'Tipo',
  priceStandard: 'Precio Estándar',
  priceInvestor: 'Precio Inversionista',
  active:        'Estado',
  isActive:      'Estado',
  code:          'Código',
  notes:         'Notas',
};

/**
 * Format a raw field value for display.
 */
function formatValue(field, value) {
  if (value === null || value === undefined) return '—';

  if (field === 'active' || field === 'isActive') {
    return value === true || value === 'true' ? 'Activo' : 'Inactivo';
  }
  if (field === 'type') {
    return value === 'produced' ? 'Producido' : value === 'resale' ? 'Reventa' : value;
  }
  if (field === 'priceStandard' || field === 'priceInvestor') {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return new Intl.NumberFormat('es-DO', {
        style: 'currency', currency: 'DOP', minimumFractionDigits: 2,
      }).format(num);
    }
  }
  return String(value);
}

// ─── Date / Time Helpers ──────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-DO', {
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
