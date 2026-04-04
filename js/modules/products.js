/**
 * products.js — CapFlow Products Module
 *
 * Handles all UI and interactions for product management:
 *  - Render the product form (create / edit)
 *  - Load and display the products table
 *  - Deactivate / reactivate products (soft-delete)
 *
 * Schema (v2 — price-free):
 *   id, name, type ('manufactured' | 'resale'), active, createdAt, updatedAt
 *
 * Price is NOT stored here. Revenue lives in the Sales module.
 * Cost of manufactured products is derived monthly from Raw Materials + Production.
 *
 * Data source: api.js → ProductsAPI (localStorage prototype).
 * When the backend is ready, flip USE_LOCAL_STORE in api.js — this file needs
 * zero changes.
 *
 * All visible text: Spanish
 * All code identifiers: English
 * No business logic lives here.
 */

import { ProductsAPI, ChangeHistoryAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** Holds the product currently being edited, or null for "create" mode. */
let editingProduct = null;

/**
 * Current value of the status filter dropdown.
 * 'all' | 'active' | 'inactive'
 * Persisted here so loadProducts() can restore the filter after each reload.
 */
let activeFilter = 'all';

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Products module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export function mountProducts(container) {
  console.log('[CapFlow] Products module loaded ✔', typeof mountProducts);
  container.innerHTML = buildModuleHTML();
  attachFormListeners();
  loadProducts();
}

// ─── HTML Builders ────────────────────────────────────────────────────────────

/** Returns the full module markup as a string. */
function buildModuleHTML() {
  return `
    <section class="module" id="products-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">⬡</span>
          <div>
            <h1 class="module-header__title">Gestión de Productos</h1>
            <p class="module-header__subtitle">Catálogo de productos fabricados y de reventa</p>
          </div>
        </div>
        <div class="module-header__badge" id="products-count-badge">
          — productos
        </div>
      </header>

      <!-- ── Product Form Card ── -->
      <div class="card" id="product-form-card">
        <div class="card__header">
          <h2 class="card__title" id="form-title">
            <span class="card__title-icon">+</span>
            Nuevo Producto
          </h2>
          <button class="btn btn--ghost btn--sm" id="form-cancel-btn" style="display:none;">
            ✕ Cancelar
          </button>
        </div>

        <form id="product-form" novalidate>
          <!-- Hidden field for edit mode -->
          <input type="hidden" id="field-id">

          <div class="form-grid">

            <!-- Nombre del producto -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="field-name">
                Nombre del Producto <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="field-name"
                placeholder="Ej: Tapa de plástico 50mm"
                maxlength="120"
                required
              >
              <span class="form-error" id="error-name"></span>
            </div>

            <!-- Tipo de producto -->
            <div class="form-group">
              <label class="form-label" for="field-type">
                Tipo de Producto <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="field-type" required>
                  <option value="" disabled selected>Seleccionar tipo…</option>
                  <option value="manufactured">Fabricado</option>
                  <option value="resale">Reventa</option>
                </select>
              </div>
              <span class="form-error" id="error-type"></span>
            </div>

            <!-- Estado -->
            <div class="form-group">
              <label class="form-label" for="field-active">Estado</label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="field-active">
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              </div>
            </div>

          </div><!-- /form-grid -->

          <!-- Form Actions -->
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="form-submit-btn">
              <span class="btn__icon">＋</span>
              Crear Producto
            </button>
          </div>
        </form>
      </div>

      <!-- ── Feedback Banner ── -->
      <div class="feedback-banner" id="feedback-banner" role="alert" aria-live="polite"></div>

      <!-- ── Products Table Card ── -->
      <div class="card" id="products-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Listado de Productos
          </h2>
          <div class="table-controls">
            <div class="select-wrapper">
              <select
                class="form-input form-select form-input--sm"
                id="filter-status"
                aria-label="Filtrar por estado"
              >
                <option value="all">Todos los estados</option>
                <option value="active">Solo activos</option>
                <option value="inactive">Solo inactivos</option>
              </select>
            </div>
            <input
              class="form-input form-input--sm"
              type="search"
              id="table-search"
              placeholder="Buscar producto…"
              aria-label="Buscar producto"
            >
          </div>
        </div>

        <!-- Loading state -->
        <div class="table-loading" id="table-loading">
          <div class="spinner"></div>
          <span>Cargando productos…</span>
        </div>

        <!-- Empty state -->
        <div class="table-empty" id="table-empty" style="display:none;">
          <span class="table-empty__icon">📦</span>
          <p>No hay productos registrados aún.</p>
          <p class="table-empty__sub">Crea el primero usando el formulario de arriba.</p>
        </div>

        <!-- Table -->
        <div class="table-wrapper" id="table-wrapper" style="display:none;">
          <table class="data-table" id="products-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th class="text-center">Estado</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="products-tbody"></tbody>
          </table>
        </div>

      </div>
    </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

/** All products stored in memory for search filtering */
let allProducts = [];

/**
 * Fetch products from the API and render them into the table.
 */
async function loadProducts() {
  showTableLoading(true);

  try {
    allProducts = await ProductsAPI.getAll();
    // Restore the user's active filter after every data reload.
    // This means create/edit/delete don't reset the dropdown.
    applyFilters();
  } catch (err) {
    showFeedback(`Error al cargar productos: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

/**
 * Render an array of product objects into the table body.
 * @param {Array} products
 */
function renderTable(products) {
  showTableLoading(false);

  const tbody    = document.getElementById('products-tbody');
  const empty    = document.getElementById('table-empty');
  const wrapper  = document.getElementById('table-wrapper');

  if (!products || products.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = products.map(buildTableRow).join('');

  // Attach row-level action listeners
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => handleEdit(btn.dataset.id));
  });

  tbody.querySelectorAll('[data-action="toggle-status"]').forEach(btn => {
    btn.addEventListener('click', () => handleToggleStatus(btn.dataset.id, btn.dataset.active === 'true'));
  });

  tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id, btn.dataset.name));
  });
}

/**
 * Build a single <tr> HTML string for a product row.
 * No price columns — price lives in the Sales module.
 * @param {Object} product
 * @returns {string}
 */
function buildTableRow(product) {
  // API returns 'manufactured' for all fabricated products.
  // Gracefully handle legacy 'produced' value that may exist in old records.
  const isMfg       = product.type === 'manufactured' || product.type === 'produced';
  const typeLabel   = isMfg ? 'Fabricado' : 'Reventa';
  const typeClass   = isMfg ? 'badge--blue' : 'badge--teal';
  // Inventory link — manufactured products get a linked badge once an inventory item exists
  const invLinked   = isMfg && product.inventoryItemId;
  const invBadge    = isMfg
    ? (invLinked
        ? `<span class="badge badge--green" style="font-size:0.7rem;" title="Artículo de inventario vinculado">▦ Vinculado</span>`
        : `<span class="badge badge--gray"  style="font-size:0.7rem;" title="Se vincula al primer registro de producción">▦ Sin vincular</span>`)
    : '';
  const isActive    = product.active !== false;
  const statusLabel = isActive ? 'Activo' : 'Inactivo';
  const statusClass = isActive ? 'badge--green' : 'badge--gray';
  const toggleLabel = isActive ? 'Desactivar' : 'Activar';
  const toggleClass = isActive ? 'btn--warning-ghost' : 'btn--success-ghost';

  return `
    <tr class="table-row ${isActive ? '' : 'table-row--inactive'}">
      <td class="td-name">${escapeHTML(product.name)}</td>
      <td><span class="badge ${typeClass}">${typeLabel}</span> ${invBadge}</td>
      <td class="text-center">
        <span class="badge ${statusClass}">${statusLabel}</span>
      </td>
      <td class="text-center td-actions">
        <button
          class="btn btn--ghost btn--xs"
          data-action="edit"
          data-id="${product.id}"
          title="Editar producto"
        >✎ Editar</button>
        <button
          class="btn ${toggleClass} btn--xs"
          data-action="toggle-status"
          data-id="${product.id}"
          data-active="${isActive}"
          title="${toggleLabel} producto"
        >${toggleLabel}</button>
        <button
          class="btn btn--danger btn--xs"
          data-action="delete"
          data-id="${product.id}"
          data-name="${escapeHTML(product.name)}"
          title="Eliminar producto permanentemente"
        >✕ Eliminar</button>
      </td>
    </tr>
  `;
}

// ─── Form Interactions ────────────────────────────────────────────────────────

/** Attach all form-related event listeners. */
function attachFormListeners() {
  const form         = document.getElementById('product-form');
  const cancelBtn    = document.getElementById('form-cancel-btn');
  const searchInput  = document.getElementById('table-search');
  const statusFilter = document.getElementById('filter-status');

  form.addEventListener('submit', handleFormSubmit);
  cancelBtn.addEventListener('click', resetFormToCreateMode);

  // Both controls feed into the same applyFilters() coordinator
  searchInput.addEventListener('input',   applyFilters);
  statusFilter.addEventListener('change', applyFilters);
}

/**
 * Handle form submission for both create and edit modes.
 * @param {Event} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) return;

  const submitBtn = document.getElementById('form-submit-btn');
  setButtonLoading(submitBtn, true);

  const payload = collectFormData();

  try {
    if (editingProduct) {
      // ── Edit mode → PUT
      await ProductsAPI.update(editingProduct.id, payload);
      showFeedback('Producto actualizado correctamente.', 'success');

      const changes = _buildDiff(editingProduct, payload, ['name', 'type', 'active']);
      ChangeHistoryAPI.log({
        entity_type: 'product', entity_id: editingProduct.id,
        entity_name: payload.name, action: 'editar', changes,
      });
    } else {
      // ── Create mode → POST
      const result = await ProductsAPI.create(payload);
      showFeedback('Producto creado correctamente.', 'success');

      ChangeHistoryAPI.log({
        entity_type: 'product', entity_id: result?.id ?? '',
        entity_name: payload.name, action: 'crear', changes: null,
      });
    }

    resetFormToCreateMode();
    await loadProducts();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Populate the form with a product's data and switch to edit mode.
 * @param {string} productId
 */
function handleEdit(productId) {
  const product = allProducts.find(p => String(p.id) === String(productId));
  if (!product) return;

  editingProduct = product;

  // Populate fields (no price fields — removed in v2 schema)
  document.getElementById('field-id').value     = product.id;
  document.getElementById('field-name').value   = product.name || '';
  document.getElementById('field-type').value   = product.type || '';
  document.getElementById('field-active').value = String(product.active !== false);

  // Update form header
  document.getElementById('form-title').innerHTML = `
    <span class="card__title-icon">✎</span>
    Editar Producto
  `;
  document.getElementById('form-submit-btn').innerHTML  = '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('form-cancel-btn').style.display = 'inline-flex';

  // Scroll to form
  document.getElementById('product-form-card').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Toggle a product's active/inactive status.
 * @param {string} productId
 * @param {boolean} currentlyActive
 */
async function handleToggleStatus(productId, currentlyActive) {
  const verb = currentlyActive ? 'desactivar' : 'activar';

  if (!confirm(`¿Deseas ${verb} este producto?`)) return;

  const product = allProducts.find(p => String(p.id) === String(productId));

  try {
    await ProductsAPI.setStatus(productId, !currentlyActive);
    const msg = currentlyActive ? 'Producto desactivado.' : 'Producto activado.';
    showFeedback(msg, 'success');

    ChangeHistoryAPI.log({
      entity_type: 'product', entity_id: productId,
      entity_name: product?.name ?? '',
      action: currentlyActive ? 'desactivar' : 'activar',
      changes: { active: { before: currentlyActive, after: !currentlyActive } },
    });

    await loadProducts();
  } catch (err) {
    showFeedback(`Error al cambiar estado: ${err.message}`, 'error');
  }
}

/**
 * Permanently delete a product after user confirmation.
 * NOTE: This is a prototype-phase action. In production this will
 * be replaced by setStatus() (deactivate), not a hard delete.
 * @param {string} productId
 * @param {string} productName  - Shown in the confirmation dialog
 */
async function handleDelete(productId, productName) {
  const confirmed = confirm(
    `¿Estás seguro de que deseas eliminar "${productName}"?\n\nEsta acción no se puede deshacer.`
  );
  if (!confirmed) return;

  try {
    await ProductsAPI.remove(productId);
    showFeedback(`Producto "${productName}" eliminado.`, 'success');

    ChangeHistoryAPI.log({
      entity_type: 'product', entity_id: productId,
      entity_name: productName, action: 'eliminar', changes: null,
    });

    // If we were editing this product, reset the form
    if (editingProduct && String(editingProduct.id) === String(productId)) {
      resetFormToCreateMode();
    }

    await loadProducts();
  } catch (err) {
    showFeedback(`Error al eliminar: ${err.message}`, 'error');
  }
}

/** Reset the form back to "create new product" mode. */
function resetFormToCreateMode() {
  editingProduct = null;

  document.getElementById('product-form').reset();
  document.getElementById('field-id').value = '';

  document.getElementById('form-title').innerHTML = `
    <span class="card__title-icon">+</span>
    Nuevo Producto
  `;
  document.getElementById('form-submit-btn').innerHTML  = '<span class="btn__icon">＋</span> Crear Producto';
  document.getElementById('form-cancel-btn').style.display = 'none';

  clearFormErrors();
}

// ─── Search & Filter Coordinator ──────────────────────────────────────────────────────────────────

/**
 * Single coordinator that reads both the search input and the status
 * filter select, applies both simultaneously, then re-renders the table.
 *
 * Called by both the search <input> and the status <select> on every
 * change, so the two controls always stay in sync with each other.
 * Also called by loadProducts() after every data reload so the active
 * filter is preserved across create / edit / delete operations.
 */
function applyFilters() {
  const query  = (document.getElementById('table-search')?.value || '').trim().toLowerCase();
  const status = document.getElementById('filter-status')?.value || 'all';

  // Persist selection in module state so re-renders can restore it
  activeFilter = status;

  let results = allProducts;

  // 1. Name search (case-insensitive substring match)
  if (query) {
    results = results.filter(p => p.name.toLowerCase().includes(query));
  }

  // 2. Status filter
  if (status === 'active') {
    results = results.filter(p => p.active !== false);
  } else if (status === 'inactive') {
    results = results.filter(p => p.active === false);
  }

  // Show "X de Y productos" in badge when a filter is narrowing results
  const isFiltered = query || status !== 'all';
  updateCountBadge(allProducts.length, isFiltered ? results.length : null);

  renderTable(results);
}
// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Check whether a product name already exists in allProducts,
 * ignoring the product currently being edited (so a no-change
 * save doesn't falsely trigger this).
 *
 * Comparison is case-insensitive and trims surrounding whitespace.
 *
 * @param {string} name - The name entered in the form
 * @returns {boolean} true if a DIFFERENT product already uses this name
 */
function isNameDuplicate(name) {
  const normalized = name.trim().toLowerCase();
  return allProducts.some(p => {
    // Skip the product currently open in the edit form
    if (editingProduct && String(p.id) === String(editingProduct.id)) return false;
    return p.name.trim().toLowerCase() === normalized;
  });
}

/**
 * Validate required fields. Displays inline errors.
 * @returns {boolean} true if valid
 */
function validateForm() {
  clearFormErrors();
  let valid = true;

  const name = document.getElementById('field-name').value.trim();
  const type = document.getElementById('field-type').value;

  if (!name) {
    showFieldError('error-name', 'El nombre del producto es obligatorio.');
    valid = false;
  } else if (isNameDuplicate(name)) {
    showFieldError(
      'error-name',
      `Ya existe un producto llamado "${name}". Por favor usa un nombre diferente.`
    );
    valid = false;
  }
  if (!type) {
    showFieldError('error-type', 'Selecciona el tipo de producto.');
    valid = false;
  }

  return valid;
}

/** Clear all inline field errors. */
function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(el => (el.textContent = ''));
  document.querySelectorAll('.form-input').forEach(el => el.classList.remove('form-input--error'));
}

/**
 * Show an error message under a specific field.
 * @param {string} errorId - ID of the <span class="form-error">
 * @param {string} message
 */
function showFieldError(errorId, message) {
  const el = document.getElementById(errorId);
  if (el) el.textContent = message;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a field-level diff between the original record and the new payload. */
function _buildDiff(original, updated, fields) {
  const diff = {};
  for (const f of fields) {
    if (String(original[f] ?? '') !== String(updated[f] ?? '')) {
      diff[f] = { before: original[f], after: updated[f] };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

/**
 * Collect form values into a plain payload object.
 * No price fields — v2 schema has none.
 * @returns {Object}
 */
function collectFormData() {
  return {
    name:   document.getElementById('field-name').value.trim(),
    type:   document.getElementById('field-type').value,
    active: document.getElementById('field-active').value === 'true',
  };
}

/**
 * Show/hide the table loading spinner.
 * @param {boolean} loading
 */
function showTableLoading(loading) {
  document.getElementById('table-loading').style.display  = loading ? 'flex' : 'none';
  document.getElementById('table-wrapper').style.display  = loading ? 'none' : '';
  document.getElementById('table-empty').style.display    = 'none';
}

/**
 * Fire a toast notification in the global #toast-container.
 *
 * Toasts stack vertically, slide in from the right, and auto-dismiss.
 * Clicking a toast dismisses it immediately.
 *
 * @param {string} message                         - Text to display
 * @param {'success'|'error'|'warning'|'info'} type - Visual variant
 * @param {number} [duration=4000]                 - Auto-dismiss in ms
 */
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

  // Dismiss: play exit animation then remove from DOM
  const dismiss = () => {
    if (toast.classList.contains('toast--exiting')) return; // already dismissing
    toast.classList.add('toast--exiting');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  toast.addEventListener('click', dismiss);
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

/**
 * Update the product count badge in the module header.
 * Shows "X de Y productos" when a filter is narrowing results,
 * or simply "Y productos" when the full list is shown.
 *
 * @param {number}      total       - Total products in the store
 * @param {number|null} [filtered]  - Filtered count, null = unfiltered
 */
function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('products-count-badge');
  if (!badge) return;

  if (filtered !== null && filtered !== total) {
    badge.textContent = `${filtered} de ${total} producto${total !== 1 ? 's' : ''}`;
  } else {
    badge.textContent = `${total} producto${total !== 1 ? 's' : ''}`;
  }
}

/**
 * Put a button in a loading/disabled state.
 * @param {HTMLButtonElement} btn
 * @param {boolean} loading
 */
function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.dataset.originalText = btn.dataset.originalText || btn.innerHTML;
  btn.innerHTML = loading
    ? '<span class="spinner spinner--sm"></span> Guardando…'
    : btn.dataset.originalText;
}

/**
 * Format a number as Dominican Peso currency string.
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('es-DO', {
    style:    'currency',
    currency: 'DOP',
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * Escape HTML special characters to prevent XSS in rendered content.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}