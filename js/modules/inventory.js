/**
 * inventory.js — CapFlow Inventory Module
 *
 * Manages operational stock for:
 *   - Finished products (type: 'finished_product')
 *
 * Raw materials are tracked monthly via Raw Materials purchases +
 * MonthlyInventoryAPI. They do NOT appear as operational stock items here.
 * Legacy 'raw_material' items in storage are displayed read-only but
 * cannot be created through this UI.
 *
 * Work-in-progress is NOT tracked here.
 *
 * Every stock change is recorded as a movement entry — the full audit trail
 * is always available in the Movements tab.
 *
 * FUTURE INTEGRATION HOOK:
 *   The Sales module will call:
 *     InventoryAPI.removeStock(itemId, quantity, saleId, note?)
 *   to auto-deduct stock when a sale is saved.
 *   No changes to this file are required for that integration.
 *
 * Data source: api.js → InventoryAPI (localStorage prototype).
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

import { InventoryAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** All items loaded from the API, held in memory for rendering. */
let allItems = [];

/** All movements loaded from the API, held in memory for the history tab. */
let allMovements = [];

/**
 * The item currently being edited in the create/edit form.
 * null = create mode.
 */
let editingItem = null;

/**
 * Active tab: 'items' | 'movements'
 */
let activeTab = 'items';

/**
 * Current status filter for the items table.
 * 'all' | 'finished_product'
 */
let typeFilter = 'all';

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Inventory module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export async function mountInventory(container) {
  container.innerHTML = buildShellHTML();
  injectStyles();
  attachListeners();
  await loadData();
}

// ─── HTML Builders ────────────────────────────────────────────────────────────

function buildShellHTML() {
  return `
    <section class="module" id="inventory-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">▦</span>
          <div>
            <h1 class="module-header__title">Inventario</h1>
            <p class="module-header__subtitle">Stock operacional de productos terminados</p>
          </div>
        </div>
        <div class="module-header__badge" id="inv-count-badge">— artículos</div>
      </header>

      <!-- ── Item Form Card ── -->
      <div class="card" id="inv-form-card">
        <div class="card__header">
          <h2 class="card__title" id="inv-form-title">
            <span class="card__title-icon">+</span>
            Nuevo Artículo
          </h2>
          <button class="btn btn--ghost btn--sm" id="inv-form-cancel-btn" style="display:none;">
            ✕ Cancelar
          </button>
        </div>

        <form id="inv-item-form" novalidate>
          <input type="hidden" id="inv-field-id">

          <div class="form-grid">

            <div class="form-group form-group--wide">
              <label class="form-label" for="inv-field-name">
                Nombre <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="inv-field-name"
                placeholder="Ej: PVC reciclado, Tapa 50mm"
                maxlength="120"
                required
              >
              <span class="form-error" id="inv-error-name"></span>
            </div>

            <div class="form-group">
              <label class="form-label" for="inv-field-type">
                Tipo <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="inv-field-type" required>
                  <option value="" disabled selected>Seleccionar tipo…</option>
                  <option value="finished_product">Producto Terminado</option>
                </select>
              </div>
              <span class="form-error" id="inv-error-type"></span>
            </div>

            <div class="form-group">
              <label class="form-label" for="inv-field-unit">
                Unidad <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="inv-field-unit"
                placeholder="Ej: lbs, kg, unidades"
                maxlength="20"
                required
              >
              <span class="form-error" id="inv-error-unit"></span>
            </div>

          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="inv-form-submit-btn">
              <span class="btn__icon">＋</span>
              Crear Artículo
            </button>
          </div>
        </form>
      </div>

      <!-- ── Tab Navigation ── -->
      <div class="inv-tabs">
        <button class="inv-tab inv-tab--active" data-tab="items">
          ▦ Artículos
        </button>
        <button class="inv-tab" data-tab="movements">
          ☰ Movimientos
        </button>
      </div>

      <!-- ── Items Table Panel ── -->
      <div class="card" id="inv-items-panel">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">▦</span>
            Listado de Artículos
          </h2>
          <div class="table-controls">
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="inv-filter-type" aria-label="Filtrar por tipo">
                <option value="all">Todos los tipos</option>
                <option value="finished_product">Producto Terminado</option>
              </select>
            </div>
            <input
              class="form-input form-input--sm"
              type="search"
              id="inv-search"
              placeholder="Buscar artículo…"
              aria-label="Buscar artículo"
            >
          </div>
        </div>

        <div class="table-loading" id="inv-items-loading">
          <div class="spinner"></div>
          <span>Cargando artículos…</span>
        </div>

        <div class="table-empty" id="inv-items-empty" style="display:none;">
          <span class="table-empty__icon">▦</span>
          <p>No hay artículos registrados aún.</p>
          <p class="table-empty__sub">Crea el primero usando el formulario de arriba.</p>
        </div>

        <div class="table-wrapper" id="inv-items-wrapper" style="display:none;">
          <table class="data-table" id="inv-items-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th class="text-right">Stock</th>
                <th>Unidad</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="inv-items-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- ── Movements Table Panel ── -->
      <div class="card" id="inv-movements-panel" style="display:none;">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Historial de Movimientos
          </h2>
          <div class="module-header__badge" id="inv-movements-badge">— registros</div>
        </div>

        <div class="table-empty" id="inv-movements-empty" style="display:none;">
          <span class="table-empty__icon">☰</span>
          <p>No hay movimientos registrados aún.</p>
        </div>

        <div class="table-wrapper" id="inv-movements-wrapper" style="display:none;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Artículo</th>
                <th>Tipo</th>
                <th class="text-right">Cantidad</th>
                <th>Referencia</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody id="inv-movements-tbody"></tbody>
          </table>
        </div>
      </div>

    </section>

    <!-- ── Stock Action Modal ── -->
    <div class="inv-modal-backdrop inv-modal-hidden" id="inv-modal-backdrop">
      <div class="inv-modal" role="dialog" aria-modal="true" aria-labelledby="inv-modal-title">
        <div class="inv-modal__header">
          <h3 class="inv-modal__title" id="inv-modal-title">Acción de Stock</h3>
          <button class="inv-modal__close" id="inv-modal-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="inv-modal__body">
          <input type="hidden" id="inv-modal-item-id">
          <input type="hidden" id="inv-modal-mode">

          <div class="form-group" id="inv-modal-qty-group">
            <label class="form-label" for="inv-modal-qty" id="inv-modal-qty-label">
              Cantidad <span class="required">*</span>
            </label>
            <input
              class="form-input"
              type="number"
              id="inv-modal-qty"
              step="0.001"
              placeholder="0"
            >
            <span class="form-error" id="inv-modal-error"></span>
          </div>

          <!-- Adjustment sign selector (shown only in adjust mode) -->
          <div class="form-group" id="inv-modal-sign-group" style="display:none;">
            <label class="form-label">Dirección del ajuste</label>
            <div class="inv-sign-row">
              <label class="inv-sign-option">
                <input type="radio" name="inv-adjust-sign" value="positive" checked>
                <span>＋ Aumentar stock</span>
              </label>
              <label class="inv-sign-option">
                <input type="radio" name="inv-adjust-sign" value="negative">
                <span>− Reducir stock</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="inv-modal-note">Nota (opcional)</label>
            <input
              class="form-input"
              type="text"
              id="inv-modal-note"
              placeholder="Ej: Conteo físico, corrección de error…"
              maxlength="120"
            >
          </div>
        </div>
        <div class="inv-modal__footer">
          <button class="btn btn--ghost" id="inv-modal-cancel-btn">Cancelar</button>
          <button class="btn btn--primary" id="inv-modal-save-btn">Confirmar</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
  showItemsLoading(true);

  try {
    [allItems, allMovements] = await Promise.all([
      InventoryAPI.getAll(),
      InventoryAPI.getMovements(),
    ]);
    applyItemFilters();
    renderMovements();
  } catch (err) {
    showFeedback(`Error al cargar inventario: ${err.message}`, 'error');
    showItemsLoading(false);
  }
}

// ─── Items Table ──────────────────────────────────────────────────────────────

function renderItems(items) {
  showItemsLoading(false);

  const tbody   = document.getElementById('inv-items-tbody');
  const empty   = document.getElementById('inv-items-empty');
  const wrapper = document.getElementById('inv-items-wrapper');

  if (!items || items.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = items.map(buildItemRow).join('');

  tbody.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => handleEditItem(btn.dataset.id))
  );
  tbody.querySelectorAll('[data-action="add-stock"]').forEach(btn =>
    btn.addEventListener('click', () => openModal(btn.dataset.id, 'add'))
  );
  tbody.querySelectorAll('[data-action="remove-stock"]').forEach(btn =>
    btn.addEventListener('click', () => openModal(btn.dataset.id, 'remove'))
  );
  tbody.querySelectorAll('[data-action="adjust-stock"]').forEach(btn =>
    btn.addEventListener('click', () => openModal(btn.dataset.id, 'adjust'))
  );
}

function buildItemRow(item) {
  const typeLabel = 'Producto Terminado';
  const typeClass = 'badge--blue';
  const stockClass = item.stock === 0 ? 'inv-stock--zero' : 'inv-stock--ok';

  return `
    <tr class="table-row">
      <td class="td-name">${escapeHTML(item.name)}</td>
      <td><span class="badge ${typeClass}">${typeLabel}</span></td>
      <td class="text-right">
        <span class="${stockClass}">${formatQty(item.stock)}</span>
      </td>
      <td>${escapeHTML(item.unit)}</td>
      <td class="text-center td-actions">
        <button class="btn btn--ghost btn--xs"
          data-action="edit" data-id="${item.id}"
          title="Editar artículo">✎ Editar</button>
        <button class="btn btn--success-ghost btn--xs"
          data-action="add-stock" data-id="${item.id}"
          title="Agregar stock">↑ Entrada</button>
        <button class="btn btn--warning-ghost btn--xs"
          data-action="remove-stock" data-id="${item.id}"
          title="Retirar stock">↓ Salida</button>
        <button class="btn btn--ghost btn--xs"
          data-action="adjust-stock" data-id="${item.id}"
          title="Ajuste manual">⇅ Ajuste</button>
      </td>
    </tr>
  `;
}

// ─── Movements Table ──────────────────────────────────────────────────────────

function renderMovements() {
  const badge   = document.getElementById('inv-movements-badge');
  const empty   = document.getElementById('inv-movements-empty');
  const wrapper = document.getElementById('inv-movements-wrapper');
  const tbody   = document.getElementById('inv-movements-tbody');

  // Build a lookup map: itemId → item (all items, including legacy, for name resolution)
  const itemMap = new Map(allItems.map(i => [String(i.id), i]));

  // Hide movements that belong to legacy raw_material items.
  // Movements whose itemId is not found (item was deleted) are kept visible
  // so the audit trail is never silently truncated.
  const visibleMovements = allMovements.filter(m => {
    const item = itemMap.get(String(m.itemId));
    if (!item) return true;              // deleted item — show as [Artículo eliminado]
    return item.type !== 'raw_material'; // hide only known raw_material movements
  });

  badge.textContent = `${visibleMovements.length} registro${visibleMovements.length !== 1 ? 's' : ''}`;

  if (visibleMovements.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = visibleMovements.map(m => buildMovementRow(m, itemMap)).join('');
}

function buildMovementRow(mov, itemMap) {
  const item = itemMap.get(String(mov.itemId));
  const itemName = item ? escapeHTML(item.name) : `<em>[Artículo eliminado]</em>`;

  const typeConfig = {
    in:         { label: 'Entrada',   cls: 'badge--green' },
    out:        { label: 'Salida',    cls: 'badge--orange' },
    adjustment: { label: 'Ajuste',    cls: 'badge--blue'  },
  };
  const cfg = typeConfig[mov.type] || { label: mov.type, cls: 'badge--gray' };

  const qtySign  = mov.quantity >= 0 ? '+' : '';
  const qtyClass = mov.quantity >= 0 ? 'inv-qty-positive' : 'inv-qty-negative';
  const unit     = item ? ` ${escapeHTML(item.unit)}` : '';
  const refCell  = mov.referenceId
    ? `<code style="font-size:0.75rem;">${escapeHTML(String(mov.referenceId))}</code>`
    : '—';

  return `
    <tr class="table-row">
      <td>${formatDate(mov.date)}</td>
      <td>${itemName}</td>
      <td><span class="badge ${cfg.cls}">${cfg.label}</span></td>
      <td class="text-right">
        <span class="${qtyClass}">${qtySign}${formatQty(mov.quantity)}${unit}</span>
      </td>
      <td>${refCell}</td>
      <td>${escapeHTML(mov.note || '—')}</td>
    </tr>
  `;
}

// ─── Form Interactions ────────────────────────────────────────────────────────

function attachListeners() {
  // Item form
  document.getElementById('inv-item-form').addEventListener('submit', handleItemFormSubmit);
  document.getElementById('inv-form-cancel-btn').addEventListener('click', resetFormToCreateMode);

  // Filters
  document.getElementById('inv-search').addEventListener('input', applyItemFilters);
  document.getElementById('inv-filter-type').addEventListener('change', applyItemFilters);

  // Tabs
  document.querySelectorAll('.inv-tab').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // Modal
  document.getElementById('inv-modal-close').addEventListener('click', closeModal);
  document.getElementById('inv-modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('inv-modal-save-btn').addEventListener('click', handleModalSave);
  document.getElementById('inv-modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'inv-modal-backdrop') closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

async function handleItemFormSubmit(e) {
  e.preventDefault();
  if (!validateItemForm()) return;

  const btn     = document.getElementById('inv-form-submit-btn');
  const payload = collectItemFormData();
  setButtonLoading(btn, true);

  try {
    if (editingItem) {
      const updated = await InventoryAPI.updateItem(editingItem.id, payload);
      // Update in-memory
      const idx = allItems.findIndex(i => i.id === updated.id);
      if (idx !== -1) allItems[idx] = updated;
      showFeedback('Artículo actualizado correctamente.', 'success');
    } else {
      const created = await InventoryAPI.createItem(payload);
      allItems.push(created);
      showFeedback('Artículo creado correctamente.', 'success');
    }
    resetFormToCreateMode();
    applyItemFilters();
  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function handleEditItem(itemId) {
  const item = allItems.find(i => String(i.id) === String(itemId));
  if (!item) return;

  editingItem = item;

  document.getElementById('inv-field-id').value   = item.id;
  document.getElementById('inv-field-name').value  = item.name  || '';
  document.getElementById('inv-field-type').value  = item.type  || '';
  document.getElementById('inv-field-unit').value  = item.unit  || '';

  document.getElementById('inv-form-title').innerHTML = `
    <span class="card__title-icon">✎</span> Editar Artículo
  `;
  document.getElementById('inv-form-submit-btn').innerHTML = '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('inv-form-cancel-btn').style.display = 'inline-flex';

  document.getElementById('inv-form-card').scrollIntoView({ behavior: 'smooth' });
}

function resetFormToCreateMode() {
  editingItem = null;
  document.getElementById('inv-item-form').reset();
  document.getElementById('inv-field-id').value = '';
  document.getElementById('inv-form-title').innerHTML = `
    <span class="card__title-icon">+</span> Nuevo Artículo
  `;
  document.getElementById('inv-form-submit-btn').innerHTML = '<span class="btn__icon">＋</span> Crear Artículo';
  document.getElementById('inv-form-cancel-btn').style.display = 'none';
  clearItemFormErrors();
}

// ─── Tab Switching ────────────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.inv-tab').forEach(btn => {
    btn.classList.toggle('inv-tab--active', btn.dataset.tab === tab);
  });

  document.getElementById('inv-items-panel').style.display     = tab === 'items'     ? 'block' : 'none';
  document.getElementById('inv-movements-panel').style.display = tab === 'movements' ? 'block' : 'none';
}

// ─── Filter Coordinator ───────────────────────────────────────────────────────

function applyItemFilters() {
  const query = (document.getElementById('inv-search')?.value || '').trim().toLowerCase();
  const type  = document.getElementById('inv-filter-type')?.value || 'all';

  typeFilter = type;

  // Exclude legacy raw_material items entirely — they are tracked monthly
  // in the Raw Materials module, not as operational inventory.
  const visibleItems = allItems.filter(i => i.type !== 'raw_material');

  let results = visibleItems;

  if (query) {
    results = results.filter(i => i.name.toLowerCase().includes(query));
  }
  if (type !== 'all') {
    results = results.filter(i => i.type === type);
  }

  const isFiltered = query || type !== 'all';
  updateCountBadge(visibleItems.length, isFiltered ? results.length : null);
  renderItems(results);
}

// ─── Stock Modal ──────────────────────────────────────────────────────────────

const MODAL_CONFIG = {
  add:    { title: '↑ Agregar Stock',      btnClass: 'btn--primary',        qtyLabel: 'Cantidad a agregar',   showSign: false },
  remove: { title: '↓ Retirar Stock',      btnClass: 'btn--warning',        qtyLabel: 'Cantidad a retirar',   showSign: false },
  adjust: { title: '⇅ Ajuste de Stock',    btnClass: 'btn--primary',        qtyLabel: 'Cantidad del ajuste',  showSign: true  },
};

function openModal(itemId, mode) {
  const cfg = MODAL_CONFIG[mode];
  if (!cfg) return;

  const item = allItems.find(i => String(i.id) === String(itemId));
  const unitLabel = item ? ` (${escapeHTML(item.unit)})` : '';

  document.getElementById('inv-modal-item-id').value          = itemId;
  document.getElementById('inv-modal-mode').value             = mode;
  document.getElementById('inv-modal-title').textContent      = cfg.title;
  document.getElementById('inv-modal-qty-label').innerHTML    =
    `${cfg.qtyLabel}${unitLabel} <span class="required">*</span>`;
  document.getElementById('inv-modal-qty').value              = '';
  document.getElementById('inv-modal-note').value             = '';
  document.getElementById('inv-modal-error').textContent      = '';
  document.getElementById('inv-modal-sign-group').style.display = cfg.showSign ? 'block' : 'none';

  // Reset sign radio to positive
  const posRadio = document.querySelector('input[name="inv-adjust-sign"][value="positive"]');
  if (posRadio) posRadio.checked = true;

  // Style confirm button
  const saveBtn = document.getElementById('inv-modal-save-btn');
  saveBtn.className = `btn ${cfg.btnClass}`;

  document.getElementById('inv-modal-backdrop').classList.remove('inv-modal-hidden');
  document.getElementById('inv-modal-qty').focus();
}

function closeModal() {
  document.getElementById('inv-modal-backdrop').classList.add('inv-modal-hidden');
}

async function handleModalSave() {
  const itemId  = document.getElementById('inv-modal-item-id').value;
  const mode    = document.getElementById('inv-modal-mode').value;
  const rawQty  = parseFloat(document.getElementById('inv-modal-qty').value);
  const note    = document.getElementById('inv-modal-note').value.trim();
  const errEl   = document.getElementById('inv-modal-error');
  errEl.textContent = '';

  if (isNaN(rawQty) || rawQty <= 0) {
    errEl.textContent = 'La cantidad debe ser mayor que cero.';
    return;
  }

  // For adjustments, apply the chosen sign
  let qty = rawQty;
  if (mode === 'adjust') {
    const signVal = document.querySelector('input[name="inv-adjust-sign"]:checked')?.value;
    if (signVal === 'negative') qty = -rawQty;
  }

  const btn = document.getElementById('inv-modal-save-btn');
  setButtonLoading(btn, true);

  try {
    let updatedItem;

    if (mode === 'add') {
      updatedItem = await InventoryAPI.addStock(itemId, qty, note);
    } else if (mode === 'remove') {
      // null referenceId = manual removal. Sales will pass saleId here in the future.
      updatedItem = await InventoryAPI.removeStock(itemId, qty, null, note);
    } else if (mode === 'adjust') {
      updatedItem = await InventoryAPI.adjustStock(itemId, qty, note);
    }

    // Update in-memory item
    const idx = allItems.findIndex(i => String(i.id) === String(itemId));
    if (idx !== -1) allItems[idx] = updatedItem;

    // Reload movements from storage to get the new entry
    allMovements = await InventoryAPI.getMovements();

    closeModal();
    applyItemFilters();
    renderMovements();

    const labels = { add: 'Entrada', remove: 'Salida', adjust: 'Ajuste' };
    showFeedback(`${labels[mode]} registrada correctamente.`, 'success');

  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    setButtonLoading(btn, false);
  }
}

// ─── Form Validation ──────────────────────────────────────────────────────────

function isNameDuplicate(name) {
  const normalized = name.trim().toLowerCase();
  return allItems.some(i => {
    if (editingItem && String(i.id) === String(editingItem.id)) return false;
    return i.name.trim().toLowerCase() === normalized;
  });
}

function validateItemForm() {
  clearItemFormErrors();
  let valid = true;

  const name = document.getElementById('inv-field-name').value.trim();
  const type = document.getElementById('inv-field-type').value;
  const unit = document.getElementById('inv-field-unit').value.trim();

  if (!name) {
    showFieldError('inv-error-name', 'El nombre es obligatorio.');
    valid = false;
  } else if (isNameDuplicate(name)) {
    showFieldError('inv-error-name', `Ya existe un artículo llamado "${name}".`);
    valid = false;
  }

  if (!type) {
    showFieldError('inv-error-type', 'Selecciona el tipo de artículo.');
    valid = false;
  }

  if (!unit) {
    showFieldError('inv-error-unit', 'La unidad es obligatoria.');
    valid = false;
  }

  return valid;
}

function clearItemFormErrors() {
  document.querySelectorAll('#inv-item-form .form-error').forEach(el => (el.textContent = ''));
  document.querySelectorAll('#inv-item-form .form-input').forEach(el => el.classList.remove('form-input--error'));
}

function showFieldError(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectItemFormData() {
  return {
    name: document.getElementById('inv-field-name').value.trim(),
    type: document.getElementById('inv-field-type').value,
    unit: document.getElementById('inv-field-unit').value.trim(),
  };
}

function showItemsLoading(loading) {
  document.getElementById('inv-items-loading').style.display  = loading ? 'flex'  : 'none';
  document.getElementById('inv-items-wrapper').style.display  = loading ? 'none'  : '';
  document.getElementById('inv-items-empty').style.display    = 'none';
}

function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('inv-count-badge');
  if (!badge) return;
  if (filtered !== null && filtered !== total) {
    badge.textContent = `${filtered} de ${total} artículo${total !== 1 ? 's' : ''}`;
  } else {
    badge.textContent = `${total} artículo${total !== 1 ? 's' : ''}`;
  }
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-DO', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatQty(qty) {
  if (qty == null) return '—';
  return new Intl.NumberFormat('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(qty);
}

function showFeedback(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✔', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${icons[type] ?? 'ℹ'}</span>
    <span class="toast__message">${escapeHTML(message)}</span>
    <span class="toast__close" aria-label="Cerrar">&times;</span>
  `;
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

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ─── Scoped Styles ────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('inventory-module-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'inventory-module-styles';
  tag.textContent = `
    /* Tabs */
    .inv-tabs {
      display: flex;
      gap: var(--space-xs);
      margin-bottom: var(--space-lg);
    }
    .inv-tab {
      background: none;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 0.875rem;
      padding: var(--space-xs) var(--space-md);
      transition: background 0.15s, color 0.15s;
    }
    .inv-tab:hover { background: var(--color-surface-hover); color: var(--color-text); }
    .inv-tab--active {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }

    /* Stock value colours */
    .inv-stock--zero { color: var(--color-text-muted); }
    .inv-stock--ok   { color: var(--color-text); font-weight: 600; }

    /* Movement quantity colours */
    .inv-qty-positive { color: var(--color-success); font-weight: 600; }
    .inv-qty-negative { color: var(--color-danger);  font-weight: 600; }

    /* Adjust sign radio row */
    .inv-sign-row {
      display: flex;
      gap: var(--space-lg);
      padding: var(--space-sm) 0;
    }
    .inv-sign-option {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--color-text);
    }

    /* Modal */
    .inv-modal-hidden { display: none !important; }
    .inv-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
    }
    .inv-modal {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      width: 100%; max-width: 440px;
      padding: var(--space-xl);
    }
    .inv-modal__header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: var(--space-lg);
    }
    .inv-modal__title { margin: 0; font-size: 1rem; }
    .inv-modal__close {
      background: none; border: none;
      color: var(--color-text-muted); font-size: 1.1rem;
      cursor: pointer; padding: 2px 6px;
    }
    .inv-modal__close:hover { color: var(--color-text); }
    .inv-modal__footer {
      display: flex; justify-content: flex-end;
      gap: var(--space-sm); margin-top: var(--space-lg);
    }
    .text-right { text-align: right; }
  `;
  document.head.appendChild(tag);
}