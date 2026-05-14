/**
 * changelog.js — CapFlow Historial de Cambios
 *
 * Muestra cada movimiento del sistema como una notificación legible
 * en lenguaje natural. Incluye también los registros que llegan desde
 * CapDispatch (despachos, entradas de materia prima, producción diaria,
 * pesos de paquetes).
 *
 * Datos en Supabase: tabla `change_history`.
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

import { ChangeHistoryAPI } from '../api.js';

// ─── Entry Point ──────────────────────────────────────────────────────────────

export function mountChangelog(container) {
  container.innerHTML = buildModuleHTML();
  injectStyles();
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
            <h1 class="module-header__title">Historial</h1>
            <p class="module-header__subtitle">
              Todo lo que pasa en el sistema, en orden y en lenguaje claro
            </p>
          </div>
        </div>
        <div class="module-header__badge" id="changelog-count-badge">— movimientos</div>
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
            <label class="form-label" for="filter-entity-type">Tipo</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="filter-entity-type">
                <option value="">Todos</option>
                <option value="product">Productos</option>
                <option value="machine">Máquinas</option>
                <option value="customer">Clientes</option>
                <option value="operator">Operarios</option>
                <option value="sale">Ventas</option>
                <option value="expense">Gastos</option>
                <option value="material_receipt">Entrada de materia prima</option>
                <option value="package_weight">Peso de paquete</option>
                <option value="daily_production">Producción diaria</option>
                <option value="production">Producción</option>
                <option value="investor">Inversionista</option>
                <option value="payroll">Nómina</option>
                <option value="raw_material">Materia prima</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="filter-action">Acción</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="filter-action">
                <option value="">Todas</option>
                <option value="crear">Creación</option>
                <option value="editar">Edición</option>
                <option value="activar">Activación</option>
                <option value="desactivar">Desactivación</option>
                <option value="eliminar">Eliminación</option>
                <option value="confirmar">Confirmación</option>
                <option value="rechazar">Rechazo</option>
                <option value="recibir">Recepción desde CapDispatch</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="filter-source">Origen</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="filter-source">
                <option value="">Todos</option>
                <option value="capflow">CapFlow</option>
                <option value="capdispatch">CapDispatch</option>
                <option value="sistema">Sistema</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="filter-search">Buscar</label>
            <input class="form-input form-input--sm" type="search" id="filter-search"
              placeholder="Buscar por nombre, usuario o texto…" aria-label="Buscar en historial">
          </div>
        </div>
      </div>

      <!-- Feed -->
      <div class="card" id="changelog-list-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Movimientos recientes
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
            (y la 008 para origen) en el SQL Editor de Supabase.
          </p>
        </div>

        <div class="table-empty" id="changelog-empty" style="display:none;">
          <span class="table-empty__icon">◷</span>
          <p id="changelog-empty-msg">Sin movimientos aún.</p>
          <p class="table-empty__sub">Cualquier cambio en el sistema aparecerá aquí.</p>
        </div>

        <div id="changelog-timeline" style="display:none;">
          <ul class="changelog-feed" id="changelog-list" role="list"></ul>
        </div>
      </div>
    </section>
  `;
}

// ─── Styles (scoped, injected once) ───────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('changelog-styles')) return;
  const style = document.createElement('style');
  style.id = 'changelog-styles';
  style.textContent = `
    .changelog-feed {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-sm, 8px);
    }
    .changelog-card {
      display: grid;
      grid-template-columns: 40px 1fr auto;
      align-items: start;
      gap: var(--space-md, 12px);
      padding: var(--space-md, 12px) var(--space-lg, 16px);
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-left-width: 3px;
      border-radius: var(--radius-md, 8px);
      transition: background 0.15s ease;
    }
    .changelog-card:hover { background: var(--color-surface-hover, rgba(255,255,255,0.02)); }
    .changelog-card[data-source="capdispatch"] { border-left-color: #2980b9; }
    .changelog-card[data-action="crear"]      { border-left-color: #27ae60; }
    .changelog-card[data-action="editar"]     { border-left-color: #f39c12; }
    .changelog-card[data-action="activar"]    { border-left-color: #1abc9c; }
    .changelog-card[data-action="desactivar"] { border-left-color: #95a5a6; }
    .changelog-card[data-action="eliminar"]   { border-left-color: #e74c3c; }
    .changelog-card[data-action="confirmar"]  { border-left-color: #27ae60; }
    .changelog-card[data-action="rechazar"]   { border-left-color: #e74c3c; }
    .changelog-card[data-action="recibir"]    { border-left-color: #2980b9; }
    .changelog-card__avatar {
      width: 40px; height: 40px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem;
      background: var(--color-surface-raised, #1a2030);
      color: var(--color-text);
      flex-shrink: 0;
    }
    .changelog-card[data-action="crear"]      .changelog-card__avatar { background:#27ae6020; color:#27ae60; }
    .changelog-card[data-action="editar"]     .changelog-card__avatar { background:#f39c1220; color:#f39c12; }
    .changelog-card[data-action="activar"]    .changelog-card__avatar { background:#1abc9c20; color:#1abc9c; }
    .changelog-card[data-action="desactivar"] .changelog-card__avatar { background:#95a5a620; color:#95a5a6; }
    .changelog-card[data-action="eliminar"]   .changelog-card__avatar { background:#e74c3c20; color:#e74c3c; }
    .changelog-card[data-action="confirmar"]  .changelog-card__avatar { background:#27ae6020; color:#27ae60; }
    .changelog-card[data-action="rechazar"]   .changelog-card__avatar { background:#e74c3c20; color:#e74c3c; }
    .changelog-card[data-action="recibir"]    .changelog-card__avatar { background:#2980b920; color:#2980b9; }
    .changelog-card__body { min-width: 0; }
    .changelog-card__message {
      font-size: 0.95rem;
      line-height: 1.45;
      color: var(--color-text);
      word-break: break-word;
    }
    .changelog-card__message strong { color: var(--color-text); }
    .changelog-card__meta {
      margin-top: 4px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      font-size: 0.75rem;
      color: var(--color-text-muted);
      align-items: center;
    }
    .changelog-card__chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 8px;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: var(--color-bg-base);
      font-size: 0.7rem;
      line-height: 1.6;
    }
    .changelog-card__chip--source-capdispatch { color:#2980b9; border-color:#2980b988; background:#2980b912; }
    .changelog-card__chip--source-capflow     { color:var(--color-text-muted); }
    .changelog-card__chip--source-sistema     { color:#95a5a6; }
    .changelog-card__time {
      text-align: right;
      font-size: 0.72rem;
      color: var(--color-text-muted);
      white-space: nowrap;
      align-self: flex-start;
    }
    .changelog-card__time small { display:block; opacity:.7; font-size:0.68rem; }
    .changelog-card__details {
      margin-top: var(--space-sm, 8px);
    }
    .changelog-card__details summary {
      cursor: pointer;
      font-size: 0.78rem;
      color: var(--color-text-muted);
      user-select: none;
      list-style: none;
      padding: 2px 0;
    }
    .changelog-card__details summary::before {
      content: '▸';
      display: inline-block;
      margin-right: 4px;
      transition: transform 0.15s ease;
    }
    .changelog-card__details[open] summary::before { transform: rotate(90deg); }
    .changelog-diff {
      margin-top: 6px;
      border-collapse: collapse;
      width: 100%;
      font-size: 0.78rem;
    }
    .changelog-diff th, .changelog-diff td {
      padding: 4px 8px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--color-border);
    }
    .changelog-diff th {
      font-weight: 600;
      color: var(--color-text-muted);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .changelog-diff .cl-before { color: var(--color-danger, #e74c3c); text-decoration: line-through; opacity: 0.85; }
    .changelog-diff .cl-after  { color: var(--color-success, #27ae60); font-weight: 500; }
    .changelog-diff .cl-arrow  { color: var(--color-text-muted); text-align: center; }
    @media (max-width: 640px) {
      .changelog-card { grid-template-columns: 36px 1fr; }
      .changelog-card__time { grid-column: 2; text-align: left; margin-top: 2px; }
    }
  `;
  document.head.appendChild(style);
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadChangelog() {
  showLoading(true);
  try {
    allEntries = await ChangeHistoryAPI.getAll({ limit: 300 });
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
  const source     = document.getElementById('filter-source')?.value ?? '';
  const search     = (document.getElementById('filter-search')?.value ?? '').trim().toLowerCase();

  let results = allEntries;
  if (entityType) results = results.filter(e => e.entity_type === entityType);
  if (action)     results = results.filter(e => e.action === action);
  if (source)     results = results.filter(e => (e.source ?? 'capflow') === source);
  if (search) {
    results = results.filter(e => {
      const hay = [
        e.entity_name, e.user_name, e.description,
        buildMessage(e, { plain: true }),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search);
    });
  }

  updateCountBadge(allEntries.length, results.length !== allEntries.length ? results.length : null);
  renderTimeline(results);
}

function renderTimeline(entries) {
  showLoading(false);
  if (!entries || entries.length === 0) {
    const msg = allEntries.length === 0
      ? 'Sin movimientos aún.'
      : 'No hay movimientos que coincidan con los filtros.';
    const sub = document.getElementById('changelog-empty-msg');
    if (sub) sub.textContent = msg;
    showState('empty');
    return;
  }
  showState('list');

  const groups = groupByDay(entries);
  const html = groups.map(g => `
    <li class="changelog-day-label" style="
      font-size:.72rem;
      text-transform:uppercase;
      letter-spacing:.06em;
      color:var(--color-text-muted);
      padding:var(--space-sm,8px) 4px 0;
      margin-top:var(--space-sm,8px);
      border-top:1px dashed var(--color-border);
    ">${escapeHTML(g.label)}</li>
    ${g.entries.map(buildEntryCard).join('')}
  `).join('');

  document.getElementById('changelog-list').innerHTML = html;
}

function groupByDay(entries) {
  const groups = new Map();
  for (const e of entries) {
    const d = new Date(e.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups.has(key)) {
      groups.set(key, { label: humanDayLabel(d), entries: [] });
    }
    groups.get(key).entries.push(e);
  }
  return [...groups.values()];
}

function buildEntryCard(entry) {
  const action = entry.action || 'editar';
  const source = entry.source || 'capflow';
  const icon   = ACTION_ICONS[action] ?? '·';
  const message = buildMessage(entry);
  const diff = buildDiffHTML(entry.changes);
  const time = formatTime(entry.created_at);
  const date = formatShortDate(entry.created_at);
  const userChip = entry.user_name
    ? `<span class="changelog-card__chip">👤 ${escapeHTML(entry.user_name)}</span>`
    : '';
  const sourceChip = source !== 'capflow'
    ? `<span class="changelog-card__chip changelog-card__chip--source-${escapeAttr(source)}">
         ${source === 'capdispatch' ? '📦 CapDispatch' : source === 'sistema' ? '⚙ Sistema' : escapeHTML(source)}
       </span>`
    : '';

  return `
    <li class="changelog-card" data-action="${escapeAttr(action)}" data-source="${escapeAttr(source)}">
      <div class="changelog-card__avatar" aria-hidden="true">${icon}</div>
      <div class="changelog-card__body">
        <div class="changelog-card__message">${message}</div>
        <div class="changelog-card__meta">
          ${userChip}
          ${sourceChip}
        </div>
        ${diff}
      </div>
      <div class="changelog-card__time">
        ${escapeHTML(time)}
        <small>${escapeHTML(date)}</small>
      </div>
    </li>
  `;
}

// ─── Natural-language message builder ────────────────────────────────────────

/**
 * Build the human-readable sentence for an entry.
 * If the writer provided a pre-built `description`, prefer that.
 * Otherwise compose from (action, entity_type, entity_name, user_name, changes).
 *
 * @param {Object}  entry
 * @param {Object}  [opts]
 * @param {boolean} [opts.plain=false]  Return plain text (no HTML tags) for search.
 */
function buildMessage(entry, opts = {}) {
  const plain = opts.plain === true;
  const wrap  = (text) => plain ? text : text; // already escaped where needed

  if (entry.description) {
    return plain ? entry.description : escapeHTML(entry.description);
  }

  const user   = entry.user_name || 'Alguien';
  const action = entry.action || 'editar';
  const type   = entry.entity_type;
  const name   = entry.entity_name || '—';

  const article = ENTITY_ARTICLE[type] || 'el registro';
  const label   = ENTITY_SINGULAR[type] || type || 'registro';
  const verb    = ACTION_VERBS[action] || action;

  const safeUser = plain ? user : `<strong>${escapeHTML(user)}</strong>`;
  const safeName = plain ? name : `<strong>${escapeHTML(name)}</strong>`;

  // Receipts from CapDispatch get their own phrasing
  if (action === 'recibir') {
    const what = label;
    const who  = entry.user_name ? ` (operador ${plain ? user : escapeHTML(user)})` : '';
    return plain
      ? `Se recibió ${article} ${what} ${name} desde CapDispatch${who}.`
      : `Se recibió ${article} ${label} ${safeName} desde <strong>CapDispatch</strong>${entry.user_name ? ` <em>(operador ${escapeHTML(user)})</em>` : ''}.`;
  }

  // Field-level summary if we have a diff
  const fieldSummary = summarizeChanges(entry.changes, plain);
  const suffix = fieldSummary ? ` — ${fieldSummary}` : '';

  // Generic phrasing: "<User> <verb> <article> <label> '<name>'[ — changes]."
  return plain
    ? `${user} ${verb} ${article} ${label} ${name}${suffix}.`
    : `${safeUser} ${verb} ${article} ${label} ${safeName}${suffix}.`;
}

function summarizeChanges(changes, plain) {
  if (!changes || typeof changes !== 'object') return '';
  const keys = Object.keys(changes).filter(k => !k.startsWith('_'));
  if (keys.length === 0) return '';

  // Up to 3 inline fragments; rest collapses into "y N más".
  const fragments = keys.slice(0, 3).map(field => {
    const fl = FIELD_LABELS[field] ?? field;
    const { before, after } = changes[field] || {};
    const fmtBefore = formatValue(field, before);
    const fmtAfter  = formatValue(field, after);

    if (before === null || before === undefined || before === '') {
      return plain
        ? `definió ${fl} como “${fmtAfter}”`
        : `definió <em>${escapeHTML(fl)}</em> como <strong>${escapeHTML(fmtAfter)}</strong>`;
    }
    if (after === null || after === undefined || after === '') {
      return plain
        ? `quitó ${fl}`
        : `quitó <em>${escapeHTML(fl)}</em>`;
    }
    return plain
      ? `cambió ${fl} de “${fmtBefore}” a “${fmtAfter}”`
      : `cambió <em>${escapeHTML(fl)}</em> de <strong>${escapeHTML(fmtBefore)}</strong> a <strong>${escapeHTML(fmtAfter)}</strong>`;
  });

  const extra = keys.length - 3;
  if (extra > 0) fragments.push(plain ? `y ${extra} más` : `y <em>${extra} más</em>`);
  return fragments.join(', ');
}

function buildDiffHTML(changes) {
  if (!changes || typeof changes !== 'object') return '';
  const keys = Object.keys(changes).filter(k => !k.startsWith('_'));
  if (keys.length === 0) return '';

  const rows = keys.map(field => {
    const fl = FIELD_LABELS[field] ?? field;
    const { before, after } = changes[field] || {};
    return `
      <tr>
        <td>${escapeHTML(fl)}</td>
        <td class="cl-before">${escapeHTML(formatValue(field, before))}</td>
        <td class="cl-arrow" aria-hidden="true">→</td>
        <td class="cl-after">${escapeHTML(formatValue(field, after))}</td>
      </tr>`;
  }).join('');

  return `
    <details class="changelog-card__details">
      <summary>Ver detalle de los campos</summary>
      <table class="changelog-diff">
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
  document.getElementById('filter-source')?.addEventListener('change', applyFilters);
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
    'changelog-empty':    state === 'empty',
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
    ? `${filtered} de ${total} movimientos`
    : `${total} movimiento${total !== 1 ? 's' : ''}`;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

const ACTION_ICONS = {
  crear:      '＋',
  editar:     '✎',
  activar:    '✔',
  desactivar: '⏸',
  eliminar:   '✕',
  confirmar:  '✓',
  rechazar:   '⊘',
  recibir:    '⇩',
};

const ACTION_VERBS = {
  crear:      'creó',
  editar:     'actualizó',
  activar:    'activó',
  desactivar: 'desactivó',
  eliminar:   'eliminó',
  confirmar:  'confirmó',
  rechazar:   'rechazó',
  recibir:    'recibió',
};

const ENTITY_SINGULAR = {
  product:           'producto',
  machine:           'máquina',
  customer:          'cliente',
  operator:          'operario',
  sale:              'venta',
  expense:           'gasto',
  material_receipt:  'entrada de materia prima',
  package_weight:    'peso de paquete',
  daily_production:  'producción diaria',
  production:        'producción',
  raw_material:      'materia prima',
  investor:          'movimiento de inversionista',
  payroll:           'recibo de nómina',
};

const ENTITY_ARTICLE = {
  product:           'el',
  machine:           'la',
  customer:          'el',
  operator:          'al',
  sale:              'la',
  expense:           'el',
  material_receipt:  'la',
  package_weight:    'el',
  daily_production:  'la',
  production:        'la',
  raw_material:      'la',
  investor:          'el',
  payroll:           'el',
};

const FIELD_LABELS = {
  name:           'nombre',
  type:           'tipo',
  active:         'estado',
  isActive:       'estado',
  is_active:      'estado',
  code:           'código',
  notes:          'notas',
  phone:          'teléfono',
  email:          'email',
  taxId:          'RNC',
  tax_id:         'RNC',
  address:        'dirección',
  price:          'precio',
  quantity:       'cantidad',
  weight_lbs:     'peso (lbs)',
  provider:       'proveedor',
  shift:          'turno',
  color:          'color',
  product_id:     'producto',
  machine_id:     'máquina',
  operator_id:    'operario',
  operator_name:  'operario',
  status:         'estado',
  motivo:         'motivo',
  total:          'total',
  amount:         'monto',
  date:           'fecha',
  receipt_date:   'fecha',
  sale_date:      'fecha',
  production_date:'fecha de producción',
  invoice_number: 'número de factura',
  payment_method: 'método de pago',
  category:       'categoría',
  role:           'rol',
  pin:            'PIN',
  despachado:     'fecha de despacho',
  operario:       'operario',
};

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'active' || field === 'isActive' || field === 'is_active')
    return (value === true || value === 'true' || value === 1) ? 'Activo' : 'Inactivo';
  if (field === 'type')
    return value === 'manufactured' ? 'Fabricado'
         : value === 'resale'        ? 'Reventa'
         : String(value);
  if (field === 'status') {
    const map = {
      pending_review: 'Pendiente de revisión',
      confirmed:      'Confirmado',
      rejected:       'Rechazado',
      pending:        'Pendiente',
      paid:           'Pagado',
    };
    return map[value] ?? String(value);
  }
  if (field === 'payment_method')
    return value === 'cash' ? 'Efectivo' : value === 'transfer' ? 'Transferencia' : String(value);
  if (typeof value === 'number') return value.toLocaleString('es-DO');
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function humanDayLabel(d) {
  const today = new Date();
  const yest  = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Hoy';
  if (sameDay(d, yest))  return 'Ayer';
  return d.toLocaleDateString('es-DO', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

function formatShortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}
