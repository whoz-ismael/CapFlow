/**
 * operators.js — CapFlow Operators Module
 *
 * Handles all UI and interactions for operator management:
 *  - Render the operator form (create / edit)
 *  - Load and display the operators table
 *  - Activate / deactivate operators (no permanent delete)
 *
 * Operators are permanent factory employees. Deleting them is not permitted
 * because historical production records reference their id. Deactivating
 * an operator removes them from production dropdowns without breaking any
 * existing record.
 *
 * Data source: api.js (currently backed by localStorage via LocalOperatorsStore).
 * When the backend is ready, flip USE_LOCAL_STORE in api.js — this file needs
 * zero changes.
 *
 * All visible text: Spanish
 * All code identifiers: English
 * No business logic lives here.
 */

import { OperatorsAPI }  from '../api.js';
import { ProductionAPI } from '../api.js';
import { MachinesAPI }   from '../api.js';
import { ProductsAPI }   from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** Holds the operator currently being edited, or null for "create" mode. */
let editingOperator = null;

/** In-memory cache of all operators — used for filtering without re-fetching. */
let allOperators = [];

/**
 * Current value of the status filter dropdown.
 * 'all' | 'active' | 'inactive'
 * Persisted here so loadOperators() restores the filter after each data reload.
 */
let activeFilter = 'all';

/**
 * Lookup maps for the production modal — built fresh on each modal open.
 * Keyed by String(id) so resolution is O(1) per row.
 * @type {Map<string, Object>}
 */
let machineMap = new Map();
let productMap = new Map();

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Operators module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export function mountOperators(container) {
  container.innerHTML = buildModuleHTML();
  attachFormListeners();
  loadOperators();
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

/** Returns the full module markup as an HTML string. */
function buildModuleHTML() {
  return `
    <section class="module" id="operators-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">◈</span>
          <div>
            <h1 class="module-header__title">Gestión de Operarios</h1>
            <p class="module-header__subtitle">Registro y control del personal de producción</p>
          </div>
        </div>
        <div class="module-header__badge" id="operators-count-badge">
          — operarios
        </div>
      </header>

      <!-- ── Operator Form Card ── -->
      <div class="card" id="operator-form-card">
        <div class="card__header">
          <h2 class="card__title" id="operator-form-title">
            <span class="card__title-icon">+</span>
            Nuevo Operario
          </h2>
          <button class="btn btn--ghost btn--sm" id="operator-cancel-btn" style="display:none;">
            ✕ Cancelar
          </button>
        </div>

        <form id="operator-form" novalidate>
          <!-- Hidden id for edit mode -->
          <input type="hidden" id="operator-field-id">

          <div class="form-grid">

            <!-- Nombre del Operario -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="operator-field-name">
                Nombre del Operario <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="operator-field-name"
                placeholder="Ej: Juan Pérez"
                maxlength="120"
                required
              >
              <span class="form-error" id="operator-error-name"></span>
            </div>

            <!-- Documento / Cédula -->
            <div class="form-group">
              <label class="form-label" for="operator-field-document">
                Documento / Cédula
              </label>
              <input
                class="form-input"
                type="text"
                id="operator-field-document"
                placeholder="Ej: 001-1234567-8"
                maxlength="40"
              >
              <span class="form-error" id="operator-error-document"></span>
              <span class="form-hint">Opcional — cédula u otro identificador único.</span>
            </div>

            <!-- Teléfono -->
            <div class="form-group">
              <label class="form-label" for="operator-field-phone">
                Teléfono
              </label>
              <input
                class="form-input"
                type="text"
                id="operator-field-phone"
                placeholder="Ej: 809-555-0100"
                maxlength="30"
              >
              <span class="form-hint">Opcional — número de contacto.</span>
            </div>

            <!-- Correo electrónico -->
            <div class="form-group">
              <label class="form-label" for="operator-field-email">
                Correo Electrónico
              </label>
              <input
                class="form-input"
                type="email"
                id="operator-field-email"
                placeholder="Ej: juan.perez@empresa.com"
                maxlength="120"
              >
              <span class="form-hint">Opcional — correo de contacto.</span>
            </div>

            <!-- Puesto / Cargo -->
            <div class="form-group">
              <label class="form-label" for="operator-field-position">
                Puesto / Cargo
              </label>
              <input
                class="form-input"
                type="text"
                id="operator-field-position"
                placeholder="Ej: Operador de Inyección"
                maxlength="80"
              >
              <span class="form-hint">Opcional — descripción del rol.</span>
            </div>

            <!-- Estado — solo visible en modo edición -->
            <div class="form-group" id="operator-status-group" style="display:none;">
              <label class="form-label" for="operator-field-active">Estado</label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="operator-field-active">
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              </div>
            </div>

          </div><!-- /form-grid -->

          <!-- Form Actions -->
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="operator-submit-btn">
              <span class="btn__icon">＋</span>
              Crear Operario
            </button>
          </div>
        </form>
      </div>

      <!-- ── Operators Table Card ── -->
      <div class="card" id="operators-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Listado de Operarios
          </h2>
          <div class="table-controls">
            <div class="select-wrapper">
              <select
                class="form-input form-select form-input--sm"
                id="operators-filter-status"
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
              id="operators-search"
              placeholder="Buscar por nombre…"
              aria-label="Buscar operario"
            >
          </div>
        </div>

        <!-- Loading state -->
        <div class="table-loading" id="operators-table-loading">
          <div class="spinner"></div>
          <span>Cargando operarios…</span>
        </div>

        <!-- Empty state -->
        <div class="table-empty" id="operators-table-empty" style="display:none;">
          <span class="table-empty__icon">◈</span>
          <p>No hay operarios registrados aún.</p>
          <p class="table-empty__sub">Crea el primero usando el formulario de arriba.</p>
        </div>

        <!-- Table -->
        <div class="table-wrapper" id="operators-table-wrapper" style="display:none;">
          <table class="data-table" id="operators-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Teléfono</th>
                <th>Puesto</th>
                <th class="text-center">Estado</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="operators-tbody"></tbody>
          </table>
        </div>

      </div>
    </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

/**
 * Fetch all operators from the API, store them in memory, and re-apply
 * the active filter so the table reflects any create / edit / status change.
 */
async function loadOperators() {
  showTableLoading(true);

  try {
    allOperators = await OperatorsAPI.getAll();
    // Delegate rendering to applyFilters so the active filter is always restored
    applyFilters();
  } catch (err) {
    showFeedback(`Error al cargar operarios: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

/**
 * Render an array of operator objects into the table body.
 * Called exclusively by applyFilters() — never directly.
 * @param {Array} operators
 */
function renderTable(operators) {
  showTableLoading(false);

  const tbody   = document.getElementById('operators-tbody');
  const empty   = document.getElementById('operators-table-empty');
  const wrapper = document.getElementById('operators-table-wrapper');

  if (!operators || operators.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = operators.map(buildTableRow).join('');

  // Wire row-level action buttons after injecting HTML
  tbody.querySelectorAll('[data-action="view-production"]').forEach(btn => {
    btn.addEventListener('click', () => handleViewProduction(btn.dataset.id));
  });

  tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => handleEdit(btn.dataset.id));
  });

  tbody.querySelectorAll('[data-action="toggle-status"]').forEach(btn => {
    btn.addEventListener('click', () =>
      handleToggleStatus(btn.dataset.id, btn.dataset.active === 'true')
    );
  });
}

/**
 * Build a single <tr> HTML string for an operator row.
 * Inactive rows receive the `table-row--inactive` class for visual muting.
 * @param {Object} operator
 * @returns {string}
 */
function buildTableRow(operator) {
  const isActive    = operator.isActive !== false; // default true if field is missing
  const statusLabel = isActive ? 'Activo'      : 'Inactivo';
  const statusClass = isActive ? 'badge--green' : 'badge--gray';
  const toggleLabel = isActive ? 'Desactivar'  : 'Activar';
  const toggleClass = isActive ? 'btn--warning-ghost' : 'btn--success-ghost';

  const documentDisplay = operator.document
    ? escapeHTML(operator.document)
    : '<span style="color:var(--color-text-muted)">—</span>';

  const phoneDisplay = operator.phone
    ? escapeHTML(operator.phone)
    : '<span style="color:var(--color-text-muted)">—</span>';

  const positionDisplay = operator.position
    ? escapeHTML(operator.position)
    : '<span style="color:var(--color-text-muted)">—</span>';

  return `
    <tr class="table-row ${isActive ? '' : 'table-row--inactive'}">
      <td class="td-name">${escapeHTML(operator.name)}</td>
      <td class="td-document">${documentDisplay}</td>
      <td class="td-phone">${phoneDisplay}</td>
      <td class="td-position">${positionDisplay}</td>
      <td class="text-center">
        <span class="badge ${statusClass}">${statusLabel}</span>
      </td>
      <td class="text-center td-actions">
        <button
          class="btn btn--ghost btn--xs"
          data-action="view-production"
          data-id="${operator.id}"
          title="Ver producción"
        >📊 Ver producción</button>
        <button
          class="btn btn--ghost btn--xs"
          data-action="edit"
          data-id="${operator.id}"
          title="Editar operario"
        >✎ Editar</button>
        <button
          class="btn ${toggleClass} btn--xs"
          data-action="toggle-status"
          data-id="${operator.id}"
          data-active="${isActive}"
          title="${toggleLabel} operario"
        >${toggleLabel}</button>
      </td>
    </tr>
  `;
}

// ─── Form Interactions ────────────────────────────────────────────────────────

/** Attach all form-level and filter event listeners. */
function attachFormListeners() {
  const form         = document.getElementById('operator-form');
  const cancelBtn    = document.getElementById('operator-cancel-btn');
  const searchInput  = document.getElementById('operators-search');
  const statusFilter = document.getElementById('operators-filter-status');

  form.addEventListener('submit', handleFormSubmit);
  cancelBtn.addEventListener('click', resetFormToCreateMode);

  // Both filter controls route through the same coordinator
  searchInput.addEventListener('input',   applyFilters);
  statusFilter.addEventListener('change', applyFilters);

  // Input masks — format as user types, preserve cursor intent
  document.getElementById('operator-field-document').addEventListener('input', function () {
    const formatted = formatDocumentInput(this.value);
    if (this.value !== formatted) this.value = formatted;
  });

  document.getElementById('operator-field-phone').addEventListener('input', function () {
    const formatted = formatPhoneInput(this.value);
    if (this.value !== formatted) this.value = formatted;
  });
}

/**
 * Handle form submission for both create and edit modes.
 * Validates first, then calls the appropriate API method.
 * @param {Event} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) return;

  const submitBtn = document.getElementById('operator-submit-btn');
  setButtonLoading(submitBtn, true);

  const payload = collectFormData();

  try {
    if (editingOperator) {
      // ── Edit mode → update
      await OperatorsAPI.update(editingOperator.id, payload);
      showFeedback('Operario actualizado correctamente.', 'success');
    } else {
      // ── Create mode → create (always active)
      await OperatorsAPI.create(payload);
      showFeedback('Operario creado correctamente.', 'success');
    }

    resetFormToCreateMode();
    await loadOperators();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Populate the form with an operator's data and switch to edit mode.
 * Reveals the Estado field which is hidden in create mode.
 * @param {string} operatorId
 */
function handleEdit(operatorId) {
  const operator = allOperators.find(o => String(o.id) === String(operatorId));
  if (!operator) return;

  editingOperator = operator;

  // Populate fields
  document.getElementById('operator-field-id').value       = operator.id;
  document.getElementById('operator-field-name').value     = operator.name     || '';
  document.getElementById('operator-field-document').value = formatDocumentInput(operator.document || '');
  document.getElementById('operator-field-phone').value    = formatPhoneInput(operator.phone    || '');
  document.getElementById('operator-field-email').value    = operator.email    || '';
  document.getElementById('operator-field-position').value = operator.position || '';
  document.getElementById('operator-field-active').value   = String(operator.isActive !== false);

  // Show the status field — only visible during edit
  document.getElementById('operator-status-group').style.display = '';

  // Update form chrome to edit mode
  document.getElementById('operator-form-title').innerHTML = `
    <span class="card__title-icon">✎</span>
    Editar Operario
  `;
  document.getElementById('operator-submit-btn').innerHTML =
    '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('operator-cancel-btn').style.display = 'inline-flex';

  // Scroll to the form so the user sees it filled in
  document.getElementById('operator-form-card').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Toggle an operator's active/inactive status.
 * Uses dedicated activate() / deactivate() API methods.
 * Deactivation requires explicit user confirmation.
 * If the operator being toggled is currently open in the edit form,
 * the status field is updated in-place so the form stays consistent.
 * @param {string}  operatorId
 * @param {boolean} currentlyActive
 */
async function handleToggleStatus(operatorId, currentlyActive) {
  if (currentlyActive) {
    // Deactivation is irreversible from the production dropdown — confirm first
    if (!confirm('¿Deseas desactivar este operario?')) return;
  }

  try {
    if (currentlyActive) {
      await OperatorsAPI.deactivate(operatorId);
      showFeedback('Operario desactivado.', 'warning');
    } else {
      await OperatorsAPI.activate(operatorId);
      showFeedback('Operario activado.', 'success');
    }

    // If this operator is currently open in the edit form, sync its status field
    if (editingOperator && String(editingOperator.id) === String(operatorId)) {
      editingOperator = { ...editingOperator, isActive: !currentlyActive };
      document.getElementById('operator-field-active').value = String(!currentlyActive);
    }

    await loadOperators();

  } catch (err) {
    showFeedback(`Error al cambiar estado: ${err.message}`, 'error');
  }
}

/** Reset the form back to "create new operator" mode. */
function resetFormToCreateMode() {
  editingOperator = null;

  document.getElementById('operator-form').reset();
  document.getElementById('operator-field-id').value = '';

  // Hide the status field — it only makes sense during edit
  document.getElementById('operator-status-group').style.display = 'none';

  // Restore form chrome
  document.getElementById('operator-form-title').innerHTML = `
    <span class="card__title-icon">+</span>
    Nuevo Operario
  `;
  document.getElementById('operator-submit-btn').innerHTML =
    '<span class="btn__icon">＋</span> Crear Operario';
  document.getElementById('operator-cancel-btn').style.display = 'none';

  clearFormErrors();
}

// ─── Search & Filter Coordinator ──────────────────────────────────────────────

/**
 * Read both filter controls and re-render the table with matching operators.
 *
 * Applies filters in this order:
 *  1. Text search: case-insensitive substring match on name
 *  2. Status filter: all | active | inactive
 *
 * Persists the chosen status in `activeFilter` so loadOperators() can
 * restore it after any data reload (create / edit / toggle status).
 */
function applyFilters() {
  const query  = (document.getElementById('operators-search')?.value || '').trim().toLowerCase();
  const status = document.getElementById('operators-filter-status')?.value || 'all';

  // Keep status selection alive across data reloads
  activeFilter = status;

  let results = allOperators;

  // 1. Text search — substring match on name
  if (query) {
    results = results.filter(o =>
      o.name.toLowerCase().includes(query)
    );
  }

  // 2. Status filter
  if (status === 'active') {
    results = results.filter(o => o.isActive !== false);
  } else if (status === 'inactive') {
    results = results.filter(o => o.isActive === false);
  }

  // Show "X de Y operarios" when any filter is narrowing results
  const isFiltered = query || status !== 'all';
  updateCountBadge(allOperators.length, isFiltered ? results.length : null);

  renderTable(results);
}

// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Check whether an operator name already exists in allOperators,
 * ignoring the operator currently being edited (so a no-change save
 * on the same name does not falsely trigger this).
 *
 * Comparison is case-insensitive and trims surrounding whitespace.
 *
 * @param {string} name
 * @returns {boolean} true if a DIFFERENT operator already uses this name
 */
function isNameDuplicate(name) {
  const normalized = name.trim().toLowerCase();
  return allOperators.some(o => {
    if (editingOperator && String(o.id) === String(editingOperator.id)) return false;
    return o.name.trim().toLowerCase() === normalized;
  });
}

/**
 * Check whether a document number already belongs to a different operator.
 * Returns false immediately when `doc` is empty — the field is optional.
 *
 * @param {string}      doc        - Value from the document field (may be empty)
 * @param {string|null} currentId  - ID of the operator being edited, or null on create
 * @returns {boolean} true if a DIFFERENT operator already holds this document
 */
function isDocumentDuplicate(doc, currentId = null) {
  if (!doc) return false;
  const normalized = doc.trim().toLowerCase();
  return allOperators.some(op =>
    String(op.id) !== String(currentId) &&
    op.document &&
    op.document.trim().toLowerCase() === normalized
  );
}

/**
 * Validate all required fields and uniqueness constraints.
 * Displays inline errors next to each offending field.
 * @returns {boolean} true if the form is valid and safe to submit
 */
function validateForm() {
  clearFormErrors();
  let valid = true;

  const name     = document.getElementById('operator-field-name').value.trim();
  const doc      = document.getElementById('operator-field-document').value.trim();
  const currentId = editingOperator ? editingOperator.id : null;

  // ── Name — required + unique ──────────────────────────────────
  if (!name) {
    showFieldError('operator-error-name', 'El nombre del operario es obligatorio.');
    valid = false;
  } else if (isNameDuplicate(name)) {
    showFieldError(
      'operator-error-name',
      `Ya existe un operario llamado "${name}". Usa un nombre diferente.`
    );
    valid = false;
  }

  // ── Document — optional but must be unique when provided ──────
  if (isDocumentDuplicate(doc, currentId)) {
    showFieldError(
      'operator-error-document',
      'Ya existe un operario con este número de documento.'
    );
    valid = false;
  }

  return valid;
}

/** Clear all inline field error messages. */
function clearFormErrors() {
  document.querySelectorAll('#operator-form .form-error')
    .forEach(el => (el.textContent = ''));
  document.querySelectorAll('#operator-form .form-input')
    .forEach(el => el.classList.remove('form-input--error'));
}

/**
 * Display an inline error under a specific field.
 * @param {string} errorId - ID of the target <span class="form-error">
 * @param {string} message
 */
function showFieldError(errorId, message) {
  const el = document.getElementById(errorId);
  if (el) el.textContent = message;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a raw digit string as a Dominican cédula: 000-0000000-0
 * Accepts up to 11 digits; ignores any non-digit characters in the input.
 * @param {string} raw - The current field value (may contain dashes or other chars)
 * @returns {string} Formatted display value
 */
function formatDocumentInput(raw) {
  // Strip everything that is not a digit, cap at 11
  const digits = raw.replace(/\D/g, '').slice(0, 11);

  // Build formatted string incrementally so partial input looks right
  if (digits.length <= 3)  return digits;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
}

/**
 * Format a raw digit string as a Dominican phone number: 000-000-0000
 * Accepts up to 10 digits; ignores any non-digit characters in the input.
 * @param {string} raw - The current field value (may contain dashes or other chars)
 * @returns {string} Formatted display value
 */
function formatPhoneInput(raw) {
  // Strip everything that is not a digit, cap at 10
  const digits = raw.replace(/\D/g, '').slice(0, 10);

  // Build formatted string incrementally so partial input looks right
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Collect form values into a plain operator payload object.
 * isActive is only included when the status field is visible (edit mode).
 * New operators always default to isActive: true via the API.
 * @returns {Object}
 */
function collectFormData() {
  const payload = {
    name:     document.getElementById('operator-field-name').value.trim(),
    document: document.getElementById('operator-field-document').value.replace(/\D/g, '') || '',
    phone:    document.getElementById('operator-field-phone').value.replace(/\D/g, '')    || '',
    email:    document.getElementById('operator-field-email').value.trim()    || '',
    position: document.getElementById('operator-field-position').value.trim() || '',
  };

  // Only include isActive when the status field is visible (edit mode)
  const statusGroup = document.getElementById('operator-status-group');
  if (statusGroup && statusGroup.style.display !== 'none') {
    payload.isActive = document.getElementById('operator-field-active').value === 'true';
  }

  return payload;
}

/**
 * Show/hide the table loading spinner.
 * Hides both the table wrapper and the empty state while loading.
 * @param {boolean} loading
 */
function showTableLoading(loading) {
  document.getElementById('operators-table-loading').style.display  = loading ? 'flex'  : 'none';
  document.getElementById('operators-table-wrapper').style.display  = loading ? 'none'  : '';
  document.getElementById('operators-table-empty').style.display    = 'none';
}

/**
 * Fire a toast notification using the global #toast-container.
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
 * Update the operators count badge in the module header.
 * Shows "X de Y operarios" when a filter is active and narrowing results.
 * @param {number}      total      - Total operators in the store
 * @param {number|null} [filtered] - Filtered count; null = show full total
 */
function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('operators-count-badge');
  if (!badge) return;

  if (filtered !== null && filtered !== total) {
    badge.textContent = `${filtered} de ${total} operario${total !== 1 ? 's' : ''}`;
  } else {
    badge.textContent = `${total} operario${total !== 1 ? 's' : ''}`;
  }
}

/**
 * Put a button into a loading / disabled state while an async operation runs.
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

// ─── Operator Production Modal ────────────────────────────────────────────────

/**
 * Entry point for the "Ver producción" row action.
 * Delegates immediately to the modal builder — kept separate so the calling
 * convention matches the other handle* functions in this module.
 * @param {string} operatorId
 */
async function handleViewProduction(operatorId) {
  await showOperatorProductionModal(operatorId);
}

/**
 * Build and display a read-only production history modal for one operator.
 *
 * Flow:
 *   1. Resolve operator from in-memory cache (no extra API call).
 *   2. Fetch all production records via ProductionAPI.getAll() — single call.
 *   3. Filter to this operator's records in memory — O(n).
 *   4. Calculate totals: shifts, quantity, value.
 *   5. Build and inject modal into document.body.
 *   6. Attach close handlers (button + backdrop click).
 *
 * The modal is removed from the DOM when closed — no hidden state persists.
 *
 * @param {string} operatorId
 */
async function showOperatorProductionModal(operatorId) {
  // ── 1. Resolve operator ──────────────────────────────────────────────────────
  const operator = allOperators.find(o => String(o.id) === String(operatorId));
  if (!operator) {
    showFeedback('No se encontró el operario.', 'error');
    return;
  }

  // Inject modal styles once per session — idempotent guard
  injectModalStyles();

  // Show a temporary loading overlay while fetching records
  const overlay = buildLoadingOverlay(operator.name);
  document.body.appendChild(overlay);

  try {
    // ── 2. Load machines, products, and production records in parallel ────────
    const [machines, products, allRecords] = await Promise.all([
      MachinesAPI.getAll(),
      ProductsAPI.getAll(),
      ProductionAPI.getAll(),
    ]);

    // Build lookup maps — O(n) once, then O(1) per table row
    machineMap = new Map(machines.map(m => [String(m.id), m]));
    productMap = new Map(products.map(p => [String(p.id), p]));

    const records = allRecords.filter(r =>
      String(r.operatorId) === String(operatorId)
    );

    // ── 3. Calculate totals ──────────────────────────────────────────────────
    const totalShifts   = records.length;
    const totalQuantity = records.reduce((sum, r) => sum + (r.quantity   || 0), 0);
    const totalValue    = records.reduce((sum, r) => {
      return sum + (r.quantity || 0) * (r.productPriceSnapshot || 0);
    }, 0);

    // Remove loading overlay and replace with the real modal
    overlay.remove();
    const modal = buildProductionModal(operator, records, totalShifts, totalQuantity, totalValue);
    document.body.appendChild(modal);

    // ── 4. Close behaviour ───────────────────────────────────────────────────
    const closeModal = () => {
      if (modal.classList.contains('op-modal--exiting')) return;
      modal.classList.add('op-modal--exiting');
      modal.addEventListener('animationend', () => modal.remove(), { once: true });
    };

    // Close button inside the modal header
    modal.querySelector('.op-modal__close').addEventListener('click', closeModal);

    // Click on the dark backdrop (outside the panel) also closes
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });

    // Keyboard: Escape closes too
    const handleKey = e => {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', handleKey); }
    };
    document.addEventListener('keydown', handleKey);

  } catch (err) {
    overlay.remove();
    showFeedback(`Error al cargar producción: ${err.message}`, 'error');
  }
}

/**
 * Build a lightweight full-screen loading overlay used while ProductionAPI
 * fetches data. Replaced by the real modal once the fetch completes.
 * @param {string} operatorName
 * @returns {HTMLElement}
 */
function buildLoadingOverlay(operatorName) {
  const el = document.createElement('div');
  el.className = 'op-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="op-modal__panel">
      <div class="op-modal__loading">
        <div class="spinner"></div>
        <span>Cargando producción de ${escapeHTML(operatorName)}…</span>
      </div>
    </div>
  `;
  return el;
}

/**
 * Build the full production history modal for one operator.
 * Returns an HTMLElement ready to be appended to document.body.
 *
 * @param {Object} operator
 * @param {Array}  records        - Production records filtered to this operator
 * @param {number} totalShifts
 * @param {number} totalQuantity
 * @param {number} totalValue
 * @returns {HTMLElement}
 */
function buildProductionModal(operator, records, totalShifts, totalQuantity, totalValue) {
  const statusLabel = operator.isActive !== false ? 'Activo' : 'Inactivo';
  const statusClass = operator.isActive !== false ? 'badge--green' : 'badge--gray';

  // ── Table rows — sorted newest first ──────────────────────────────────────
  const sortedRecords = [...records].sort((a, b) =>
    (b.productionDate || '').localeCompare(a.productionDate || '')
  );

  const tableRows = sortedRecords.map(r => {
    const shiftValue  = (r.quantity || 0) * (r.productPriceSnapshot || 0);
    const machineName = machineMap.get(String(r.machineId))?.name || '[Máquina eliminada]';
    const productName = productMap.get(String(r.productId))?.name || '[Producto eliminado]';
    return `
      <tr class="table-row">
        <td class="td-date" style="font-family:var(--font-mono);font-size:0.82rem;white-space:nowrap;">
          ${escapeHTML(modalFormatDate(r.productionDate))}
        </td>
        <td>${escapeHTML(machineName)}</td>
        <td>${escapeHTML(productName)}</td>
        <td class="text-right" style="font-family:var(--font-mono);">
          ${modalFormatNumber(r.quantity)}
        </td>
        <td class="text-right" style="font-family:var(--font-mono);">
          ${modalFormatCurrency(shiftValue)}
        </td>
      </tr>
    `;
  }).join('');

  const emptyState = records.length === 0
    ? `<div class="op-modal__empty">
         <span style="font-size:2rem;">📋</span>
         <p>Este operario no tiene producción registrada.</p>
       </div>`
    : '';

  const tableSection = records.length > 0
    ? `<div class="op-modal__table-wrap ${records.length > 20 ? 'op-modal__table-wrap--scroll' : ''}">
         <table class="data-table">
           <thead>
             <tr>
               <th>Fecha</th>
               <th>Máquina</th>
               <th>Producto</th>
               <th class="text-right">Cantidad</th>
               <th class="text-right">Valor del turno</th>
             </tr>
           </thead>
           <tbody>${tableRows}</tbody>
         </table>
       </div>`
    : '';

  const el = document.createElement('div');
  el.className = 'op-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Producción de ${operator.name}`);

  el.innerHTML = `
    <div class="op-modal__panel">

      <!-- ── Modal Header ── -->
      <div class="op-modal__header">
        <div class="op-modal__header-left">
          <span class="op-modal__icon">📊</span>
          <div>
            <h2 class="op-modal__title">${escapeHTML(operator.name)}</h2>
            <p class="op-modal__subtitle">
              Historial de producción
              <span class="badge ${statusClass}" style="margin-left:8px;">${statusLabel}</span>
            </p>
          </div>
        </div>
        <button class="btn btn--ghost btn--sm op-modal__close" aria-label="Cerrar">
          ✕ Cerrar
        </button>
      </div>

      <!-- ── Summary Panel ── -->
      <div class="op-modal__summary">
        <div class="op-modal__stat">
          <span class="op-modal__stat-value">${totalShifts}</span>
          <span class="op-modal__stat-label">Turnos</span>
        </div>
        <div class="op-modal__stat">
          <span class="op-modal__stat-value">${modalFormatNumber(totalQuantity)}</span>
          <span class="op-modal__stat-label">Cantidad total</span>
        </div>
        <div class="op-modal__stat">
          <span class="op-modal__stat-value">${modalFormatCurrency(totalValue)}</span>
          <span class="op-modal__stat-label">Valor total generado</span>
        </div>
      </div>

      <!-- ── Production Table ── -->
      <div class="op-modal__body">
        ${emptyState}
        ${tableSection}
      </div>

    </div>
  `;

  return el;
}

/**
 * Inject the modal CSS into <head> exactly once.
 * Using a unique id as an idempotency guard — safe to call on every modal open.
 */
function injectModalStyles() {
  if (document.getElementById('op-modal-styles')) return;

  const style = document.createElement('style');
  style.id = 'op-modal-styles';
  style.textContent = `
    /* ── Operator Production Modal ───────────────────────────── */

    .op-modal {
      position:        fixed;
      inset:           0;
      background:      rgba(5, 8, 15, 0.82);
      backdrop-filter: blur(3px);
      z-index:         1000;
      display:         flex;
      align-items:     center;
      justify-content: center;
      padding:         var(--space-lg);
      animation:       op-modal-in 0.18s ease;
    }

    .op-modal--exiting {
      animation: op-modal-out 0.15s ease forwards;
    }

    @keyframes op-modal-in  { from { opacity: 0; } to { opacity: 1; } }
    @keyframes op-modal-out { from { opacity: 1; } to { opacity: 0; } }

    .op-modal__panel {
      background:    var(--color-bg-card);
      border:        1px solid var(--color-border);
      border-top:    2px solid var(--color-accent-dim);
      border-radius: var(--radius-lg);
      box-shadow:    var(--shadow-card), 0 0 40px rgba(0,0,0,0.6);
      width:         100%;
      max-width:     860px;
      max-height:    90vh;
      display:       flex;
      flex-direction: column;
      overflow:      hidden;
      animation:     op-panel-in 0.2s cubic-bezier(.22,.68,0,1.2);
    }

    @keyframes op-panel-in {
      from { transform: scale(0.96) translateY(10px); opacity: 0; }
      to   { transform: scale(1)    translateY(0);    opacity: 1; }
    }

    .op-modal__header {
      display:          flex;
      align-items:      center;
      justify-content:  space-between;
      padding:          var(--space-md) var(--space-lg);
      background:       var(--color-bg-card-header);
      border-bottom:    1px solid var(--color-border);
      flex-shrink:      0;
    }

    .op-modal__header-left {
      display:     flex;
      align-items: center;
      gap:         var(--space-md);
    }

    .op-modal__icon {
      font-size:  1.6rem;
      line-height: 1;
    }

    .op-modal__title {
      font-family:    var(--font-display);
      font-size:      1.1rem;
      font-weight:    600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color:          var(--color-text-primary);
      margin:         0;
    }

    .op-modal__subtitle {
      font-size:  0.8rem;
      color:      var(--color-text-secondary);
      margin:     2px 0 0;
      display:    flex;
      align-items: center;
    }

    /* ── Summary stats strip ── */
    .op-modal__summary {
      display:          flex;
      gap:              1px;
      background:       var(--color-border);
      border-bottom:    1px solid var(--color-border);
      flex-shrink:      0;
    }

    .op-modal__stat {
      flex:          1;
      display:       flex;
      flex-direction: column;
      align-items:   center;
      padding:       var(--space-md) var(--space-lg);
      background:    var(--color-bg-card);
      gap:           4px;
    }

    .op-modal__stat-value {
      font-family:    var(--font-display);
      font-size:      1.35rem;
      font-weight:    700;
      color:          var(--color-accent);
      letter-spacing: 0.03em;
    }

    .op-modal__stat-label {
      font-size:  0.72rem;
      color:      var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    /* ── Scrollable body ── */
    .op-modal__body {
      overflow-y: auto;
      flex:       1;
      padding:    var(--space-md) 0 0;
    }

    .op-modal__table-wrap {
      padding: 0 var(--space-lg) var(--space-lg);
    }

    .op-modal__table-wrap--scroll {
      max-height: 420px;
      overflow-y: auto;
    }

    /* ── Empty state ── */
    .op-modal__empty {
      display:        flex;
      flex-direction: column;
      align-items:    center;
      justify-content: center;
      gap:            var(--space-md);
      padding:        var(--space-2xl) var(--space-lg);
      color:          var(--color-text-muted);
      font-size:      0.9rem;
    }

    /* ── Loading state ── */
    .op-modal__loading {
      display:         flex;
      align-items:     center;
      justify-content: center;
      gap:             var(--space-md);
      padding:         var(--space-2xl);
      color:           var(--color-text-secondary);
    }
  `;

  document.head.appendChild(style);
}

/**
 * Format a YYYY-MM-DD date string as a compact Spanish date.
 * Local version — avoids cross-module dependency on production.js.
 * @param {string} dateStr
 * @returns {string}
 */
function modalFormatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Format a number with locale-aware thousands separator.
 * Local version — avoids cross-module dependency.
 * @param {number} value
 * @returns {string}
 */
function modalFormatNumber(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO').format(value);
}

/**
 * Format a number as Dominican Peso currency (RD$).
 * Local version — avoids cross-module dependency.
 * @param {number} value
 * @returns {string}
 */
function modalFormatCurrency(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('es-DO', {
    style:                 'currency',
    currency:              'DOP',
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * Escape HTML special characters to prevent XSS when rendering user content.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}