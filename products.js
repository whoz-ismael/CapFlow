/**
 * products.js — CapFlow Products Module
 *
 * Handles all UI and interactions for product management:
 *  - Render the product form (create / edit)
 *  - Load and display the products table
 *  - Activate / deactivate products (no hard deletes)
 *
 * All visible text: Spanish
 * All code identifiers: English
 * No business logic. No LocalStorage. All data via api.js.
 */

import { ProductsAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** Holds the product currently being edited, or null for "create" mode. */
let editingProduct = null;

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Products module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export function mountProducts(container) {
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
            <p class="module-header__subtitle">Catálogo de productos producidos y de reventa</p>
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
                  <option value="produced">Producido</option>
                  <option value="resale">Reventa</option>
                </select>
              </div>
              <span class="form-error" id="error-type"></span>
            </div>

            <!-- Precio de venta estándar -->
            <div class="form-group">
              <label class="form-label" for="field-price-standard">
                Precio Estándar (RD$) <span class="required">*</span>
              </label>
              <div class="input-prefix-wrapper">
                <span class="input-prefix">$</span>
                <input
                  class="form-input form-input--prefixed"
                  type="number"
                  id="field-price-standard"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  required
                >
              </div>
              <span class="form-error" id="error-price-standard"></span>
            </div>

            <!-- Precio especial inversionista -->
            <div class="form-group">
              <label class="form-label" for="field-price-investor">
                Precio Inversionista (RD$)
              </label>
              <div class="input-prefix-wrapper">
                <span class="input-prefix">$</span>
                <input
                  class="form-input form-input--prefixed"
                  type="number"
                  id="field-price-investor"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                >
              </div>
              <span class="form-hint">Opcional — solo aplica para clientes inversionistas.</span>
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
                <th class="text-right">Precio Estándar</th>
                <th class="text-right">Precio Inversionista</th>
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
    renderTable(allProducts);
    updateCountBadge(allProducts.length);
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
}

/**
 * Build a single <tr> HTML string for a product row.
 * @param {Object} product
 * @returns {string}
 */
function buildTableRow(product) {
  const typeLabel   = product.type === 'produced' ? 'Producido' : 'Reventa';
  const typeClass   = product.type === 'produced' ? 'badge--blue' : 'badge--teal';
  const isActive    = product.active !== false; // default to true if undefined
  const statusLabel = isActive ? 'Activo' : 'Inactivo';
  const statusClass = isActive ? 'badge--green' : 'badge--gray';

  const priceStd = formatCurrency(product.priceStandard);
  const priceInv = product.priceInvestor ? formatCurrency(product.priceInvestor) : '—';

  const toggleLabel = isActive ? 'Desactivar' : 'Activar';
  const toggleClass = isActive ? 'btn--danger-ghost' : 'btn--success-ghost';

  return `
    <tr class="table-row ${isActive ? '' : 'table-row--inactive'}">
      <td class="td-name">${escapeHTML(product.name)}</td>
      <td><span class="badge ${typeClass}">${typeLabel}</span></td>
      <td class="text-right td-price">${priceStd}</td>
      <td class="text-right td-price investor-price">${priceInv}</td>
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
      </td>
    </tr>
  `;
}

// ─── Form Interactions ────────────────────────────────────────────────────────

/** Attach all form-related event listeners. */
function attachFormListeners() {
  const form      = document.getElementById('product-form');
  const cancelBtn = document.getElementById('form-cancel-btn');
  const searchInput = document.getElementById('table-search');

  form.addEventListener('submit', handleFormSubmit);
  cancelBtn.addEventListener('click', resetFormToCreateMode);
  searchInput.addEventListener('input', handleSearch);
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
    } else {
      // ── Create mode → POST
      await ProductsAPI.create(payload);
      showFeedback('Producto creado correctamente.', 'success');
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

  // Populate fields
  document.getElementById('field-id').value             = product.id;
  document.getElementById('field-name').value           = product.name || '';
  document.getElementById('field-type').value           = product.type || '';
  document.getElementById('field-price-standard').value = product.priceStandard || '';
  document.getElementById('field-price-investor').value = product.priceInvestor  || '';
  document.getElementById('field-active').value         = String(product.active !== false);

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

  try {
    await ProductsAPI.setStatus(productId, !currentlyActive);
    const msg = currentlyActive ? 'Producto desactivado.' : 'Producto activado.';
    showFeedback(msg, 'success');
    await loadProducts();
  } catch (err) {
    showFeedback(`Error al cambiar estado: ${err.message}`, 'error');
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

// ─── Search / Filter ──────────────────────────────────────────────────────────

/**
 * Filter the displayed table rows by name as the user types.
 * @param {Event} e
 */
function handleSearch(e) {
  const query   = e.target.value.trim().toLowerCase();
  const filtered = query
    ? allProducts.filter(p => p.name.toLowerCase().includes(query))
    : allProducts;

  renderTable(filtered);
}

// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Validate required fields. Displays inline errors.
 * @returns {boolean} true if valid
 */
function validateForm() {
  clearFormErrors();
  let valid = true;

  const name  = document.getElementById('field-name').value.trim();
  const type  = document.getElementById('field-type').value;
  const price = document.getElementById('field-price-standard').value;

  if (!name) {
    showFieldError('error-name', 'El nombre del producto es obligatorio.');
    valid = false;
  }
  if (!type) {
    showFieldError('error-type', 'Selecciona el tipo de producto.');
    valid = false;
  }
  if (!price || Number(price) < 0) {
    showFieldError('error-price-standard', 'Ingresa un precio estándar válido.');
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

/**
 * Collect form values into a plain payload object.
 * @returns {Object}
 */
function collectFormData() {
  return {
    name:          document.getElementById('field-name').value.trim(),
    type:          document.getElementById('field-type').value,
    priceStandard: parseFloat(document.getElementById('field-price-standard').value) || 0,
    priceInvestor: parseFloat(document.getElementById('field-price-investor').value)  || null,
    active:        document.getElementById('field-active').value === 'true',
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
 * Display a feedback banner (success or error) that auto-hides.
 * @param {string} message
 * @param {'success'|'error'} type
 */
function showFeedback(message, type = 'success') {
  const banner = document.getElementById('feedback-banner');
  banner.textContent  = message;
  banner.className    = `feedback-banner feedback-banner--${type} feedback-banner--visible`;

  clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => {
    banner.classList.remove('feedback-banner--visible');
  }, 4000);
}

/**
 * Update the product count badge in the header.
 * @param {number} count
 */
function updateCountBadge(count) {
  const badge = document.getElementById('products-count-badge');
  if (badge) badge.textContent = `${count} producto${count !== 1 ? 's' : ''}`;
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
