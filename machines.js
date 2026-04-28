/**
 * machines.js — CapFlow Machines Module
 *
 * Handles all UI and interactions for machine management:
 *  - Render the machine form (create / edit)
 *  - Load and display the machines table
 *  - Activate / deactivate machines (no permanent delete)
 *
 * Data source: api.js (currently backed by localStorage via LocalMachinesStore).
 * When the backend is ready, flip USE_LOCAL_STORE in api.js — this file needs
 * zero changes.
 *
 * All visible text: Spanish
 * All code identifiers: English
 * No business logic lives here.
 */

import { MachinesAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** Holds the machine currently being edited, or null for "create" mode. */
let editingMachine = null;

/** In-memory cache of all machines — used for filtering without re-fetching. */
let allMachines = [];

/**
 * Current value of the status filter dropdown.
 * 'all' | 'active' | 'inactive'
 * Persisted here so loadMachines() restores the filter after each data reload.
 */
let activeFilter = 'all';

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Machines module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export function mountMachines(container) {
  container.innerHTML = buildModuleHTML();
  attachFormListeners();
  loadMachines();
}

// ─── HTML Builders ────────────────────────────────────────────────────────────

/** Returns the full module markup as an HTML string. */
function buildModuleHTML() {
  return `
    <section class="module" id="machines-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">⚙</span>
          <div>
            <h1 class="module-header__title">Gestión de Máquinas</h1>
            <p class="module-header__subtitle">Registro y control del parque de maquinaria</p>
          </div>
        </div>
        <div class="module-header__badge" id="machines-count-badge">
          — máquinas
        </div>
      </header>

      <!-- ── Machine Form Card ── -->
      <div class="card" id="machine-form-card">
        <div class="card__header">
          <h2 class="card__title" id="machine-form-title">
            <span class="card__title-icon">+</span>
            Nueva Máquina
          </h2>
          <button class="btn btn--ghost btn--sm" id="machine-cancel-btn" style="display:none;">
            ✕ Cancelar
          </button>
        </div>

        <form id="machine-form" novalidate>
          <!-- Hidden id for edit mode -->
          <input type="hidden" id="machine-field-id">

          <div class="form-grid">

            <!-- Nombre de la máquina -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="machine-field-name">
                Nombre de la Máquina <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="machine-field-name"
                placeholder="Ej: Inyectora Hidráulica 250T"
                maxlength="120"
                required
              >
              <span class="form-error" id="machine-error-name"></span>
            </div>

            <!-- Código -->
            <div class="form-group">
              <label class="form-label" for="machine-field-code">
                Código <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="machine-field-code"
                placeholder="Ej: INY-001"
                maxlength="40"
                required
              >
              <span class="form-error" id="machine-error-code"></span>
            </div>

            <!-- Estado — solo visible en modo edición -->
            <div class="form-group" id="machine-status-group" style="display:none;">
              <label class="form-label" for="machine-field-active">Estado</label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="machine-field-active">
                  <option value="true">Activa</option>
                  <option value="false">Inactiva</option>
                </select>
              </div>
            </div>

            <!-- Notas -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="machine-field-notes">Notas</label>
              <textarea
                class="form-input form-textarea"
                id="machine-field-notes"
                placeholder="Observaciones, especificaciones técnicas, ubicación…"
                rows="3"
                maxlength="500"
              ></textarea>
              <span class="form-hint">Opcional — máx. 500 caracteres.</span>
            </div>

          </div><!-- /form-grid -->

          <!-- Form Actions -->
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="machine-submit-btn">
              <span class="btn__icon">＋</span>
              Guardar Máquina
            </button>
          </div>
        </form>
      </div>

      <!-- ── Machines Table Card ── -->
      <div class="card" id="machines-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Listado de Máquinas
          </h2>
          <div class="table-controls">
            <div class="select-wrapper">
              <select
                class="form-input form-select form-input--sm"
                id="machines-filter-status"
                aria-label="Filtrar por estado"
              >
                <option value="all">Todos los estados</option>
                <option value="active">Solo activas</option>
                <option value="inactive">Solo inactivas</option>
              </select>
            </div>
            <input
              class="form-input form-input--sm"
              type="search"
              id="machines-search"
              placeholder="Buscar por nombre o código…"
              aria-label="Buscar máquina"
            >
          </div>
        </div>

        <!-- Loading state -->
        <div class="table-loading" id="machines-table-loading">
          <div class="spinner"></div>
          <span>Cargando máquinas…</span>
        </div>

        <!-- Empty state -->
        <div class="table-empty" id="machines-table-empty" style="display:none;">
          <span class="table-empty__icon">⚙</span>
          <p>No hay máquinas registradas aún.</p>
          <p class="table-empty__sub">Crea la primera usando el formulario de arriba.</p>
        </div>

        <!-- Table -->
        <div class="table-wrapper" id="machines-table-wrapper" style="display:none;">
          <table class="data-table" id="machines-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Notas</th>
                <th class="text-center">Estado</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="machines-tbody"></tbody>
          </table>
        </div>

      </div>
    </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

/**
 * Fetch all machines from the API, store them in memory, and re-apply
 * the active filter so the table reflects any create/edit/status change.
 */
async function loadMachines() {
  showTableLoading(true);

  try {
    allMachines = await MachinesAPI.getAll();
    // Delegate rendering to applyFilters so the active filter is always restored
    applyFilters();
  } catch (err) {
    showFeedback(`Error al cargar máquinas: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

/**
 * Render an array of machine objects into the table body.
 * Called exclusively by applyFilters() — never directly.
 * @param {Array} machines
 */
function renderTable(machines) {
  showTableLoading(false);

  const tbody   = document.getElementById('machines-tbody');
  const empty   = document.getElementById('machines-table-empty');
  const wrapper = document.getElementById('machines-table-wrapper');

  if (!machines || machines.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = machines.map(buildTableRow).join('');

  // Wire row-level action buttons after injecting HTML
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
 * Build a single <tr> HTML string for a machine row.
 * @param {Object} machine
 * @returns {string}
 */
function buildTableRow(machine) {
  const isActive    = machine.isActive !== false; // default true if missing
  const statusLabel = isActive ? 'Activa'    : 'Inactiva';
  const statusClass = isActive ? 'badge--green' : 'badge--gray';
  const toggleLabel = isActive ? 'Desactivar' : 'Activar';
  const toggleClass = isActive ? 'btn--warning-ghost' : 'btn--success-ghost';

  // Truncate long notes for the table cell — full text lives in the data
  const notesDisplay = machine.notes
    ? escapeHTML(machine.notes.length > 60
        ? machine.notes.slice(0, 60) + '…'
        : machine.notes)
    : '<span style="color:var(--color-text-muted)">—</span>';

  return `
    <tr class="table-row ${isActive ? '' : 'table-row--inactive'}">
      <td>
        <span class="machine-code">${escapeHTML(machine.code)}</span>
      </td>
      <td class="td-name">${escapeHTML(machine.name)}</td>
      <td class="td-notes">${notesDisplay}</td>
      <td class="text-center">
        <span class="badge ${statusClass}">${statusLabel}</span>
      </td>
      <td class="text-center td-actions">
        <button
          class="btn btn--ghost btn--xs"
          data-action="edit"
          data-id="${machine.id}"
          title="Editar máquina"
        >✎ Editar</button>
        <button
          class="btn ${toggleClass} btn--xs"
          data-action="toggle-status"
          data-id="${machine.id}"
          data-active="${isActive}"
          title="${toggleLabel} máquina"
        >${toggleLabel}</button>
      </td>
    </tr>
  `;
}

// ─── Form Interactions ────────────────────────────────────────────────────────

/** Attach all form-level and filter event listeners. */
function attachFormListeners() {
  const form         = document.getElementById('machine-form');
  const cancelBtn    = document.getElementById('machine-cancel-btn');
  const searchInput  = document.getElementById('machines-search');
  const statusFilter = document.getElementById('machines-filter-status');

  form.addEventListener('submit', handleFormSubmit);
  cancelBtn.addEventListener('click', resetFormToCreateMode);

  // Both filter controls route through the same coordinator
  searchInput.addEventListener('input',   applyFilters);
  statusFilter.addEventListener('change', applyFilters);
}

/**
 * Handle form submission for both create and edit modes.
 * Validates first, then calls the appropriate API method.
 * @param {Event} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) return;

  const submitBtn = document.getElementById('machine-submit-btn');
  setButtonLoading(submitBtn, true);

  const payload = collectFormData();

  try {
    if (editingMachine) {
      // ── Edit mode → update
      await MachinesAPI.update(editingMachine.id, payload);
      showFeedback('Máquina actualizada correctamente.', 'success');
    } else {
      // ── Create mode → create
      await MachinesAPI.create(payload);
      showFeedback('Máquina creada correctamente.', 'success');
    }

    resetFormToCreateMode();
    await loadMachines();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Populate the form with a machine's data and switch to edit mode.
 * Shows the Status field (hidden in create mode).
 * @param {string} machineId
 */
function handleEdit(machineId) {
  const machine = allMachines.find(m => String(m.id) === String(machineId));
  if (!machine) return;

  editingMachine = machine;

  // Populate fields
  document.getElementById('machine-field-id').value     = machine.id;
  document.getElementById('machine-field-name').value   = machine.name   || '';
  document.getElementById('machine-field-code').value   = machine.code   || '';
  document.getElementById('machine-field-notes').value  = machine.notes  || '';
  document.getElementById('machine-field-active').value = String(machine.isActive !== false);

  // Show the status field — only visible during edit
  document.getElementById('machine-status-group').style.display = '';

  // Update form chrome to edit mode
  document.getElementById('machine-form-title').innerHTML = `
    <span class="card__title-icon">✎</span>
    Editar Máquina
  `;
  document.getElementById('machine-submit-btn').innerHTML =
    '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('machine-cancel-btn').style.display = 'inline-flex';

  // Scroll to the form so the user sees it
  document.getElementById('machine-form-card').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Toggle a machine's active/inactive status.
 * Uses dedicated activate() / deactivate() methods instead of a generic setStatus().
 * @param {string}  machineId
 * @param {boolean} currentlyActive
 */
async function handleToggleStatus(machineId, currentlyActive) {
  const verb = currentlyActive ? 'desactivar' : 'activar';

  if (!confirm(`¿Deseas ${verb} esta máquina?`)) return;

  try {
    if (currentlyActive) {
      await MachinesAPI.deactivate(machineId);
      showFeedback('Máquina desactivada.', 'warning');
    } else {
      await MachinesAPI.activate(machineId);
      showFeedback('Máquina activada.', 'success');
    }

    // If this machine was open in the edit form, refresh its displayed status
    if (editingMachine && String(editingMachine.id) === String(machineId)) {
      editingMachine = { ...editingMachine, isActive: !currentlyActive };
      document.getElementById('machine-field-active').value = String(!currentlyActive);
    }

    await loadMachines();

  } catch (err) {
    showFeedback(`Error al cambiar estado: ${err.message}`, 'error');
  }
}

/** Reset the form back to "create new machine" mode. */
function resetFormToCreateMode() {
  editingMachine = null;

  document.getElementById('machine-form').reset();
  document.getElementById('machine-field-id').value = '';

  // Hide the status field — it only makes sense during edit
  document.getElementById('machine-status-group').style.display = 'none';

  // Restore form chrome
  document.getElementById('machine-form-title').innerHTML = `
    <span class="card__title-icon">+</span>
    Nueva Máquina
  `;
  document.getElementById('machine-submit-btn').innerHTML =
    '<span class="btn__icon">＋</span> Guardar Máquina';
  document.getElementById('machine-cancel-btn').style.display = 'none';

  clearFormErrors();
}

// ─── Search & Filter Coordinator ──────────────────────────────────────────────

/**
 * Read both filter controls and re-render the table with matching machines.
 *
 * Applies filters in this order:
 *  1. Text search: substring match on name OR code (case-insensitive)
 *  2. Status filter: all | active | inactive
 *
 * Persists the chosen status in `activeFilter` so loadMachines() can
 * restore it after any data reload (create / edit / toggle status).
 */
function applyFilters() {
  const query  = (document.getElementById('machines-search')?.value || '').trim().toLowerCase();
  const status = document.getElementById('machines-filter-status')?.value || 'all';

  // Keep status selection alive across reloads
  activeFilter = status;

  let results = allMachines;

  // 1. Text search — matches name OR code
  if (query) {
    results = results.filter(m =>
      m.name.toLowerCase().includes(query) ||
      m.code.toLowerCase().includes(query)
    );
  }

  // 2. Status filter
  if (status === 'active') {
    results = results.filter(m => m.isActive !== false);
  } else if (status === 'inactive') {
    results = results.filter(m => m.isActive === false);
  }

  // Show "X de Y máquinas" when any filter is narrowing results
  const isFiltered = query || status !== 'all';
  updateCountBadge(allMachines.length, isFiltered ? results.length : null);

  renderTable(results);
}

// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Check whether a machine name already exists in allMachines,
 * ignoring the machine currently being edited.
 *
 * @param {string} name
 * @returns {boolean} true if a DIFFERENT machine already uses this name
 */
function isNameDuplicate(name) {
  const normalized = name.trim().toLowerCase();
  return allMachines.some(m => {
    if (editingMachine && String(m.id) === String(editingMachine.id)) return false;
    return m.name.trim().toLowerCase() === normalized;
  });
}

/**
 * Check whether a machine code already exists in allMachines,
 * ignoring the machine currently being edited.
 *
 * @param {string} code
 * @returns {boolean} true if a DIFFERENT machine already uses this code
 */
function isCodeDuplicate(code) {
  const normalized = code.trim().toLowerCase();
  return allMachines.some(m => {
    if (editingMachine && String(m.id) === String(editingMachine.id)) return false;
    return m.code.trim().toLowerCase() === normalized;
  });
}

/**
 * Validate all required fields and uniqueness constraints.
 * Displays inline errors next to each offending field.
 * @returns {boolean} true if the form is valid and safe to submit
 */
function validateForm() {
  clearFormErrors();
  let valid = true;

  const name = document.getElementById('machine-field-name').value.trim();
  const code = document.getElementById('machine-field-code').value.trim();

  // ── Name ──────────────────────────────────────────────────────
  if (!name) {
    showFieldError('machine-error-name', 'El nombre de la máquina es obligatorio.');
    valid = false;
  } else if (isNameDuplicate(name)) {
    showFieldError(
      'machine-error-name',
      `Ya existe una máquina llamada "${name}". Usa un nombre diferente.`
    );
    valid = false;
  }

  // ── Code ──────────────────────────────────────────────────────
  if (!code) {
    showFieldError('machine-error-code', 'El código de la máquina es obligatorio.');
    valid = false;
  } else if (isCodeDuplicate(code)) {
    showFieldError(
      'machine-error-code',
      `El código "${code}" ya está en uso. Ingresa un código único.`
    );
    valid = false;
  }

  return valid;
}

/** Clear all inline field error messages. */
function clearFormErrors() {
  document.querySelectorAll('#machine-form .form-error')
    .forEach(el => (el.textContent = ''));
  document.querySelectorAll('#machine-form .form-input')
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
 * Collect form values into a plain machine payload object.
 * isActive is only included when editing; new machines default to true.
 * @returns {Object}
 */
function collectFormData() {
  const payload = {
    name:  document.getElementById('machine-field-name').value.trim(),
    code:  document.getElementById('machine-field-code').value.trim(),
    notes: document.getElementById('machine-field-notes').value.trim() || '',
  };

  // Only include isActive when the status field is visible (edit mode)
  const statusGroup = document.getElementById('machine-status-group');
  if (statusGroup && statusGroup.style.display !== 'none') {
    payload.isActive = document.getElementById('machine-field-active').value === 'true';
  }

  return payload;
}

/**
 * Show/hide the table loading spinner.
 * Hides both table wrapper and empty state while loading.
 * @param {boolean} loading
 */
function showTableLoading(loading) {
  document.getElementById('machines-table-loading').style.display  = loading ? 'flex'  : 'none';
  document.getElementById('machines-table-wrapper').style.display  = loading ? 'none'  : '';
  document.getElementById('machines-table-empty').style.display    = 'none';
}

/**
 * Fire a toast notification using the global #toast-container.
 *
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
 * Update the machines count badge in the module header.
 * Shows "X de Y máquinas" when a filter is active and narrowing results.
 *
 * @param {number}      total      - Total machines in the store
 * @param {number|null} [filtered] - Filtered count; null = show full total
 */
function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('machines-count-badge');
  if (!badge) return;

  if (filtered !== null && filtered !== total) {
    badge.textContent = `${filtered} de ${total} máquina${total !== 1 ? 's' : ''}`;
  } else {
    badge.textContent = `${total} máquina${total !== 1 ? 's' : ''}`;
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
