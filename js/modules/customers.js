/**
 * customers.js — CapFlow Customers Module
 *
 * Handles all UI and interactions for customer management:
 *  - Render the customer form (create / edit)
 *  - Load and display the customers table
 *  - Deactivate / reactivate customers (soft-delete only — no hard deletes)
 *
 * Schema:
 *   id, name, type ('company' | 'individual'),
 *   phone, email, address, taxId,
 *   status ('active' | 'inactive'), createdAt, updatedAt
 *
 * Data source: api.js → CustomersAPI (localStorage prototype).
 * When the backend is ready, flip USE_LOCAL_STORE in api.js — this file needs
 * zero changes.
 *
 * All visible text: Spanish
 * All code identifiers: English
 * No business logic lives here.
 */

import { CustomersAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** Holds the customer currently being edited, or null for "create" mode. */
let editingCustomer = null;

/**
 * All customers loaded from the API, held in memory for search/filter.
 * Populated by loadCustomers() and kept in sync after every mutation.
 */
let allCustomers = [];

/**
 * Current value of the status filter dropdown.
 * 'all' | 'active' | 'inactive'
 * Persisted here so loadCustomers() can restore the filter after each reload.
 */
let activeFilter = 'all';

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Customers module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export function mountCustomers(container) {
  container.innerHTML = buildModuleHTML();
  attachFormListeners();
  loadCustomers();
}

// ─── HTML Builders ────────────────────────────────────────────────────────────

/** Returns the full module markup as a string. */
function buildModuleHTML() {
  return `
    <section class="module" id="customers-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">◉</span>
          <div>
            <h1 class="module-header__title">Gestión de Clientes</h1>
            <p class="module-header__subtitle">Registro de empresas e individuos</p>
          </div>
        </div>
        <div class="module-header__badge" id="customers-count-badge">
          — clientes
        </div>
      </header>

      <!-- ── Customer Form Card ── -->
      <div class="card" id="customer-form-card">
        <div class="card__header">
          <h2 class="card__title" id="cust-form-title">
            <span class="card__title-icon">+</span>
            Nuevo Cliente
          </h2>
          <button class="btn btn--ghost btn--sm" id="cust-form-cancel-btn" style="display:none;">
            ✕ Cancelar
          </button>
        </div>

        <form id="customer-form" novalidate>
          <!-- Hidden field for edit mode -->
          <input type="hidden" id="cust-field-id">

          <div class="form-grid">

            <!-- Nombre -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="cust-field-name">
                Nombre <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="cust-field-name"
                placeholder="Ej: Distribuidora El Norte, S.R.L."
                maxlength="120"
                required
              >
              <span class="form-error" id="cust-error-name"></span>
            </div>

            <!-- Tipo -->
            <div class="form-group">
              <label class="form-label" for="cust-field-type">
                Tipo <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="cust-field-type" required>
                  <option value="" disabled selected>Seleccionar tipo…</option>
                  <option value="company">Empresa</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              <span class="form-error" id="cust-error-type"></span>
            </div>

            <!-- Teléfono -->
            <div class="form-group">
              <label class="form-label" for="cust-field-phone">Teléfono</label>
              <input
                class="form-input"
                type="tel"
                id="cust-field-phone"
                placeholder="Ej: 809-555-1234"
                maxlength="30"
              >
            </div>

            <!-- Correo electrónico -->
            <div class="form-group">
              <label class="form-label" for="cust-field-email">Correo electrónico</label>
              <input
                class="form-input"
                type="email"
                id="cust-field-email"
                placeholder="Ej: contacto@empresa.com"
                maxlength="120"
              >
            </div>

            <!-- RNC / Cédula -->
            <div class="form-group">
              <label class="form-label" for="cust-field-taxid">RNC / Cédula</label>
              <input
                class="form-input"
                type="text"
                id="cust-field-taxid"
                placeholder="Ej: 101-12345-6"
                maxlength="20"
              >
            </div>

            <!-- Dirección -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="cust-field-address">Dirección</label>
              <input
                class="form-input"
                type="text"
                id="cust-field-address"
                placeholder="Ej: Av. Independencia #45, Santo Domingo"
                maxlength="200"
              >
            </div>

          </div><!-- /form-grid -->

          <!-- Form Actions -->
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="cust-form-submit-btn">
              <span class="btn__icon">＋</span>
              Crear Cliente
            </button>
          </div>
        </form>
      </div>

      <!-- ── Customers Table Card ── -->
      <div class="card" id="customers-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Listado de Clientes
          </h2>
          <div class="table-controls">
            <div class="select-wrapper">
              <select
                class="form-input form-select form-input--sm"
                id="cust-filter-status"
                aria-label="Filtrar por estado"
              >
                <option value="all">Todos los estados</option>
                <option value="active">Solo activos</option>
                <option value="inactive">Solo inactivos</option>
              </select>
            </div>
            <div class="select-wrapper">
              <select
                class="form-input form-select form-input--sm"
                id="cust-filter-type"
                aria-label="Filtrar por tipo"
              >
                <option value="all">Todos los tipos</option>
                <option value="company">Empresa</option>
                <option value="individual">Individual</option>
              </select>
            </div>
            <input
              class="form-input form-input--sm"
              type="search"
              id="cust-table-search"
              placeholder="Buscar cliente…"
              aria-label="Buscar cliente"
            >
          </div>
        </div>

        <!-- Loading state -->
        <div class="table-loading" id="cust-table-loading">
          <div class="spinner"></div>
          <span>Cargando clientes…</span>
        </div>

        <!-- Empty state -->
        <div class="table-empty" id="cust-table-empty" style="display:none;">
          <span class="table-empty__icon">◉</span>
          <p>No hay clientes registrados aún.</p>
          <p class="table-empty__sub">Crea el primero usando el formulario de arriba.</p>
        </div>

        <!-- Table -->
        <div class="table-wrapper" id="cust-table-wrapper" style="display:none;">
          <table class="data-table" id="customers-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Teléfono</th>
                <th>RNC / Cédula</th>
                <th class="text-center">Estado</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="customers-tbody"></tbody>
          </table>
        </div>

      </div>
    </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

/**
 * Fetch customers from the API, cache in allCustomers, and render.
 */
async function loadCustomers() {
  showTableLoading(true);

  try {
    allCustomers = await CustomersAPI.getAll();
    applyFilters();
  } catch (err) {
    showFeedback(`Error al cargar clientes: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

/**
 * Render an array of customer objects into the table body.
 * @param {Array} customers
 */
function renderTable(customers) {
  showTableLoading(false);

  const tbody   = document.getElementById('customers-tbody');
  const empty   = document.getElementById('cust-table-empty');
  const wrapper = document.getElementById('cust-table-wrapper');

  if (!customers || customers.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = customers.map(buildTableRow).join('');

  // Attach row-level action listeners
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => handleEdit(btn.dataset.id));
  });

  tbody.querySelectorAll('[data-action="toggle-status"]').forEach(btn => {
    btn.addEventListener('click', () =>
      handleToggleStatus(btn.dataset.id, btn.dataset.status)
    );
  });
}

/**
 * Build a single <tr> HTML string for a customer row.
 * @param {Object} customer
 * @returns {string}
 */
function buildTableRow(customer) {
  const isActive    = customer.status !== 'inactive';
  const typeLabel   = customer.type === 'company' ? 'Empresa' : 'Individual';
  const typeClass   = customer.type === 'company' ? 'badge--blue' : 'badge--teal';
  const statusLabel = isActive ? 'Activo' : 'Inactivo';
  const statusClass = isActive ? 'badge--green' : 'badge--gray';
  const toggleLabel = isActive ? 'Desactivar' : 'Activar';
  const toggleClass = isActive ? 'btn--warning-ghost' : 'btn--success-ghost';

  return `
    <tr class="table-row ${isActive ? '' : 'table-row--inactive'}">
      <td class="td-name">${escapeHTML(customer.name)}</td>
      <td><span class="badge ${typeClass}">${typeLabel}</span></td>
      <td>${escapeHTML(customer.phone || '—')}</td>
      <td>${escapeHTML(customer.taxId || '—')}</td>
      <td class="text-center">
        <span class="badge ${statusClass}">${statusLabel}</span>
      </td>
      <td class="text-center td-actions">
        <button
          class="btn btn--ghost btn--xs"
          data-action="edit"
          data-id="${customer.id}"
          title="Editar cliente"
        >✎ Editar</button>
        <button
          class="btn ${toggleClass} btn--xs"
          data-action="toggle-status"
          data-id="${customer.id}"
          data-status="${customer.status}"
          title="${toggleLabel} cliente"
        >${toggleLabel}</button>
      </td>
    </tr>
  `;
}

// ─── Form Interactions ────────────────────────────────────────────────────────

/** Attach all form-related event listeners. */
function attachFormListeners() {
  const form         = document.getElementById('customer-form');
  const cancelBtn    = document.getElementById('cust-form-cancel-btn');
  const searchInput  = document.getElementById('cust-table-search');
  const statusFilter = document.getElementById('cust-filter-status');
  const typeFilter   = document.getElementById('cust-filter-type');

  form.addEventListener('submit', handleFormSubmit);
  cancelBtn.addEventListener('click', resetFormToCreateMode);

  searchInput.addEventListener('input',   applyFilters);
  statusFilter.addEventListener('change', applyFilters);
  typeFilter.addEventListener('change',   applyFilters);
}

/**
 * Handle form submission for both create and edit modes.
 * @param {Event} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) return;

  const submitBtn = document.getElementById('cust-form-submit-btn');
  setButtonLoading(submitBtn, true);

  const payload = collectFormData();

  try {
    if (editingCustomer) {
      await CustomersAPI.update(editingCustomer.id, payload);
      showFeedback('Cliente actualizado correctamente.', 'success');
    } else {
      await CustomersAPI.create(payload);
      showFeedback('Cliente creado correctamente.', 'success');
    }

    resetFormToCreateMode();
    await loadCustomers();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Populate the form with a customer's data and switch to edit mode.
 * @param {string} customerId
 */
function handleEdit(customerId) {
  const customer = allCustomers.find(c => String(c.id) === String(customerId));
  if (!customer) return;

  editingCustomer = customer;

  document.getElementById('cust-field-id').value      = customer.id;
  document.getElementById('cust-field-name').value    = customer.name    || '';
  document.getElementById('cust-field-type').value    = customer.type    || '';
  document.getElementById('cust-field-phone').value   = customer.phone   || '';
  document.getElementById('cust-field-email').value   = customer.email   || '';
  document.getElementById('cust-field-taxid').value   = customer.taxId   || '';
  document.getElementById('cust-field-address').value = customer.address || '';

  document.getElementById('cust-form-title').innerHTML = `
    <span class="card__title-icon">✎</span>
    Editar Cliente
  `;
  document.getElementById('cust-form-submit-btn').innerHTML = '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('cust-form-cancel-btn').style.display = 'inline-flex';

  document.getElementById('customer-form-card').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Toggle a customer's active/inactive status.
 * Active → softDelete (inactive). Inactive → reactivate (active).
 * @param {string} customerId
 * @param {string} currentStatus  - 'active' | 'inactive'
 */
async function handleToggleStatus(customerId, currentStatus) {
  const isActive = currentStatus !== 'inactive';
  const verb     = isActive ? 'desactivar' : 'activar';

  if (!confirm(`¿Deseas ${verb} este cliente?`)) return;

  try {
    if (isActive) {
      await CustomersAPI.softDelete(customerId);
      showFeedback('Cliente desactivado.', 'success');
    } else {
      await CustomersAPI.reactivate(customerId);
      showFeedback('Cliente activado.', 'success');
    }
    await loadCustomers();
  } catch (err) {
    showFeedback(`Error al cambiar estado: ${err.message}`, 'error');
  }
}

/** Reset the form back to "create new customer" mode. */
function resetFormToCreateMode() {
  editingCustomer = null;

  document.getElementById('customer-form').reset();
  document.getElementById('cust-field-id').value = '';

  document.getElementById('cust-form-title').innerHTML = `
    <span class="card__title-icon">+</span>
    Nuevo Cliente
  `;
  document.getElementById('cust-form-submit-btn').innerHTML = '<span class="btn__icon">＋</span> Crear Cliente';
  document.getElementById('cust-form-cancel-btn').style.display = 'none';

  clearFormErrors();
}

// ─── Search & Filter Coordinator ──────────────────────────────────────────────

/**
 * Read search input + both filter selects, apply simultaneously, re-render.
 * Called on every input/change event and after every data reload.
 */
function applyFilters() {
  const query      = (document.getElementById('cust-table-search')?.value  || '').trim().toLowerCase();
  const status     = document.getElementById('cust-filter-status')?.value  || 'all';
  const typeFilter = document.getElementById('cust-filter-type')?.value    || 'all';

  activeFilter = status;

  let results = allCustomers;

  // 1. Name search (case-insensitive substring)
  if (query) {
    results = results.filter(c =>
      c.name.toLowerCase().includes(query) ||
      (c.taxId  || '').toLowerCase().includes(query) ||
      (c.phone  || '').toLowerCase().includes(query) ||
      (c.email  || '').toLowerCase().includes(query)
    );
  }

  // 2. Status filter
  if (status === 'active') {
    results = results.filter(c => c.status !== 'inactive');
  } else if (status === 'inactive') {
    results = results.filter(c => c.status === 'inactive');
  }

  // 3. Type filter
  if (typeFilter !== 'all') {
    results = results.filter(c => c.type === typeFilter);
  }

  const isFiltered = query || status !== 'all' || typeFilter !== 'all';
  updateCountBadge(allCustomers.length, isFiltered ? results.length : null);

  renderTable(results);
}

// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Check whether a customer name already exists in allCustomers,
 * skipping the customer currently being edited.
 * @param {string} name
 * @returns {boolean}
 */
function isNameDuplicate(name) {
  const normalized = name.trim().toLowerCase();
  return allCustomers.some(c => {
    if (editingCustomer && String(c.id) === String(editingCustomer.id)) return false;
    return c.name.trim().toLowerCase() === normalized;
  });
}

/**
 * Validate required fields. Displays inline errors.
 * @returns {boolean} true if valid
 */
function validateForm() {
  clearFormErrors();
  let valid = true;

  const name = document.getElementById('cust-field-name').value.trim();
  const type = document.getElementById('cust-field-type').value;

  if (!name) {
    showFieldError('cust-error-name', 'El nombre del cliente es obligatorio.');
    valid = false;
  } else if (isNameDuplicate(name)) {
    showFieldError(
      'cust-error-name',
      `Ya existe un cliente llamado "${name}". Por favor usa un nombre diferente.`
    );
    valid = false;
  }

  if (!type) {
    showFieldError('cust-error-type', 'Selecciona el tipo de cliente.');
    valid = false;
  }

  return valid;
}

/** Clear all inline field errors. */
function clearFormErrors() {
  document.querySelectorAll('#customer-form .form-error').forEach(el => (el.textContent = ''));
  document.querySelectorAll('#customer-form .form-input').forEach(el => el.classList.remove('form-input--error'));
}

/**
 * Show an error message under a specific field.
 * @param {string} errorId
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
    name:    document.getElementById('cust-field-name').value.trim(),
    type:    document.getElementById('cust-field-type').value,
    phone:   document.getElementById('cust-field-phone').value.trim(),
    email:   document.getElementById('cust-field-email').value.trim(),
    taxId:   document.getElementById('cust-field-taxid').value.trim(),
    address: document.getElementById('cust-field-address').value.trim(),
  };
}

/**
 * Show/hide the table loading spinner.
 * @param {boolean} loading
 */
function showTableLoading(loading) {
  document.getElementById('cust-table-loading').style.display  = loading ? 'flex' : 'none';
  document.getElementById('cust-table-wrapper').style.display  = loading ? 'none' : '';
  document.getElementById('cust-table-empty').style.display    = 'none';
}

/**
 * Fire a toast notification in the global #toast-container.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} [duration=4000]
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

  const dismiss = () => {
    if (toast.classList.contains('toast--exiting')) return;
    toast.classList.add('toast--exiting');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  toast.addEventListener('click', dismiss);
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

/**
 * Update the customer count badge in the module header.
 * @param {number}      total
 * @param {number|null} [filtered]
 */
function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('customers-count-badge');
  if (!badge) return;

  if (filtered !== null && filtered !== total) {
    badge.textContent = `${filtered} de ${total} cliente${total !== 1 ? 's' : ''}`;
  } else {
    badge.textContent = `${total} cliente${total !== 1 ? 's' : ''}`;
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
 * Escape HTML special characters to prevent XSS in rendered content.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}