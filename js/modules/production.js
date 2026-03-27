/**
 * production.js — CapFlow Production Module
 *
 * Manages production records — each record ties a machine, product,
 * quantity, shift, and operator to a specific date.
 *
 * BUSINESS RULES:
 *   1. One shift per operator per day — creating a record for an operator
 *      on a date they already have a record is blocked at the module level.
 *
 * CRITICAL — SNAPSHOT INTEGRITY:
 *   The operator rate entered in the form is stamped as `operatorRateSnapshot`.
 *   This value is NEVER recalculated or overwritten after creation.
 *   Historical financial accuracy depends on this guarantee.
 *
 * Data flow:
 *   ProductionAPI  ← all record CRUD
 *   MachinesAPI    ← dropdown population (active machines only)
 *   ProductsAPI    ← dropdown population (active products only) + price snapshot
 *   OperatorsAPI   ← dropdown population (active operators only) + lookup map
 *
 * Existing inactive resources referenced by old records are still displayed
 * correctly via lookup maps — they just don't appear in the form dropdowns.
 *
 * All visible text: Spanish
 * All code identifiers: English
 * No business logic (payroll, invoicing) lives here.
 */

import { ProductionAPI } from '../api.js';
import { MachinesAPI }   from '../api.js';
import { ProductsAPI }   from '../api.js';
import { OperatorsAPI }  from '../api.js';
import { InventoryAPI }               from '../api.js';
import { ensureProductInventoryItem } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

/** Record currently being edited, or null for "create" mode. */
let editingRecord = null;

/** In-memory cache of all records — used for filtering without re-fetching. */
let allRecords = [];

/**
 * Lookup maps built once per load — allow O(1) name resolution in table rows
 * even when a resource has been deactivated since the record was made.
 * @type {Map<string, Object>}
 */
let machineMap  = new Map();
let productMap  = new Map();
let operatorMap = new Map();


/**
 * Active filter state — persisted across data reloads so create/edit/delete
 * never resets the filters the user has configured.
 */
let activeFilters = {
  dateFrom:   '',
  dateTo:     '',
  machineId:  '',
  productId:  '',
  operatorId: '',
};

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Mount the Production module into the given container element.
 * Called by the router in app.js.
 * @param {HTMLElement} container
 */
export async function mountProduction(container) {
  container.innerHTML = buildModuleHTML();
  await loadDependencies();      // populate dropdowns + build lookup maps
  attachFormListeners();
  resetFormToCreateMode();       // set default field values (incl. rate = 70)
  await loadRecords();
}

// ─── HTML Builders ────────────────────────────────────────────────────────────

/** Returns the full module markup as an HTML string. */
function buildModuleHTML() {
  return `
    <section class="module" id="production-module">

      <!-- ── Page Header ── -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">⬡</span>
          <div>
            <h1 class="module-header__title">Registro de Producción</h1>
            <p class="module-header__subtitle">Control de turnos, operadores y cantidades producidas</p>
          </div>
        </div>
        <div class="module-header__badge" id="production-count-badge">
          — registros
        </div>
      </header>

      <!-- ── Production Form Card ── -->
      <div class="card" id="production-form-card">
        <div class="card__header">
          <h2 class="card__title" id="production-form-title">
            <span class="card__title-icon">+</span>
            Nuevo Registro
          </h2>
          <button class="btn btn--ghost btn--sm" id="production-cancel-btn" style="display:none;">
            ✕ Cancelar
          </button>
        </div>

        <form id="production-form" novalidate>
          <input type="hidden" id="prod-field-id">

          <div class="form-grid">

            <!-- Máquina -->
            <div class="form-group">
              <label class="form-label" for="prod-field-machine">
                Máquina <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="prod-field-machine" required>
                  <option value="" disabled selected>Seleccionar máquina…</option>
                </select>
              </div>
              <span class="form-error" id="prod-error-machine"></span>
            </div>

            <!-- Producto -->
            <div class="form-group">
              <label class="form-label" for="prod-field-product">
                Producto <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="prod-field-product" required>
                  <option value="" disabled selected>Seleccionar producto…</option>
                </select>
              </div>
              <span class="form-error" id="prod-error-product"></span>
            </div>

            <!-- Cantidad -->
            <div class="form-group">
              <label class="form-label" for="prod-field-quantity">
                Cantidad <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="number"
                id="prod-field-quantity"
                placeholder="0"
                min="1"
                step="1"
                required
              >
              <span class="form-error" id="prod-error-quantity"></span>
            </div>

            <!-- Turno -->
            <div class="form-group">
              <label class="form-label" for="prod-field-shift">
                Turno <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="prod-field-shift" required>
                  <option value="" disabled selected>Seleccionar turno…</option>
                  <option value="Matutino">Matutino</option>
                  <option value="Vespertino">Vespertino</option>
                  <option value="Nocturno">Nocturno</option>
                </select>
              </div>
              <span class="form-error" id="prod-error-shift"></span>
            </div>

            <!-- Operario (dropdown — managed entity) -->
            <div class="form-group">
              <label class="form-label" for="prod-field-operator">
                Operario <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="prod-field-operator" required>
                  <option value="" disabled selected>Seleccionar operario…</option>
                </select>
              </div>
              <span class="form-error" id="prod-error-operator"></span>
            </div>

            <!-- Tarifa por paquete -->
            <div class="form-group">
              <label class="form-label" for="prod-field-rate">
                Tarifa por Paquete (RD$) <span class="required">*</span>
              </label>
              <div class="input-prefix-wrapper">
                <span class="input-prefix">$</span>
                <input
                  class="form-input form-input--prefixed"
                  type="number"
                  id="prod-field-rate"
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  required
                >
              </div>
              <span class="form-error" id="prod-error-rate"></span>
              <span class="form-hint">
                Se guardará como snapshot — no cambiará si la tarifa se modifica después.
              </span>
            </div>

            <!-- Peso por paquete -->
            <div class="form-group">
              <label class="form-label" for="prod-field-weight">
                Peso por Paquete (lb) <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="number"
                id="prod-field-weight"
                placeholder="0.00"
                min="0"
                step="0.01"
                required
              >
              <span class="form-error" id="prod-error-weight"></span>
              <span class="form-hint">
                Peso de 1,000 tapas pesadas en turno matutino. Se guarda como snapshot.
              </span>
            </div>

            <!-- Fecha de producción -->
            <div class="form-group">
              <label class="form-label" for="prod-field-date">
                Fecha de Producción <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="date"
                id="prod-field-date"
                required
              >
              <span class="form-error" id="prod-error-date"></span>
            </div>

            <!-- Snapshot info panel — shown in edit mode only -->
            <div class="form-group form-group--wide" id="prod-snapshot-panel" style="display:none;">
              <div class="snapshot-panel">
                <span class="snapshot-panel__label">⚠ Valores de snapshot (solo lectura)</span>
                <div class="snapshot-panel__values">
                  <span>Tarifa al registrar:
                    <strong id="prod-snapshot-rate-display">—</strong>
                  </span>
                </div>
                <p class="snapshot-panel__note">
                  Estos valores históricos nunca cambian. Puedes editar los demás campos.
                </p>
              </div>
            </div>

          </div><!-- /form-grid -->


          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="production-submit-btn">
              <span class="btn__icon">＋</span>
              Guardar Registro
            </button>
          </div>
        </form>
      </div>

      <!-- ── Filter Card ── -->
      <div class="card" id="production-filters-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">⊟</span>
            Filtros
          </h2>
          <button class="btn btn--ghost btn--sm" id="production-clear-filters-btn">
            ↺ Limpiar filtros
          </button>
        </div>
        <div class="production-filters">

          <!-- Fecha desde -->
          <div class="form-group">
            <label class="form-label" for="prod-filter-date-from">Fecha desde</label>
            <input class="form-input form-input--sm" type="date" id="prod-filter-date-from">
          </div>

          <!-- Fecha hasta -->
          <div class="form-group">
            <label class="form-label" for="prod-filter-date-to">Fecha hasta</label>
            <input class="form-input form-input--sm" type="date" id="prod-filter-date-to">
          </div>

          <!-- Filtro por máquina -->
          <div class="form-group">
            <label class="form-label" for="prod-filter-machine">Máquina</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="prod-filter-machine">
                <option value="">Todas las máquinas</option>
              </select>
            </div>
          </div>

          <!-- Filtro por producto -->
          <div class="form-group">
            <label class="form-label" for="prod-filter-product">Producto</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="prod-filter-product">
                <option value="">Todos los productos</option>
              </select>
            </div>
          </div>

          <!-- Filtro por operario -->
          <div class="form-group">
            <label class="form-label" for="prod-filter-operator">Operario</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="prod-filter-operator">
                <option value="">Todos los operarios</option>
              </select>
            </div>
          </div>

        </div><!-- /production-filters -->
      </div>

      <!-- ── Records Table Card ── -->
      <div class="card" id="production-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">☰</span>
            Registros de Producción
          </h2>
        </div>

        <!-- Loading state -->
        <div class="table-loading" id="production-table-loading">
          <div class="spinner"></div>
          <span>Cargando registros…</span>
        </div>

        <!-- Empty state -->
        <div class="table-empty" id="production-table-empty" style="display:none;">
          <span class="table-empty__icon">⬡</span>
          <p>No hay registros de producción aún.</p>
          <p class="table-empty__sub">Crea el primero usando el formulario de arriba.</p>
        </div>

        <!-- Table -->
        <div class="table-wrapper" id="production-table-wrapper" style="display:none;">
          <table class="data-table" id="production-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Máquina</th>
                <th>Producto</th>
                <th class="text-right">Cantidad</th>
                <th>Turno</th>
                <th>Operario</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="production-tbody"></tbody>
          </table>
        </div>

      </div>
    </section>
  `;
}

// ─── Dependency Loading ───────────────────────────────────────────────────────

/**
 * Fetch machines, products, and operators in parallel.
 * Builds lookup maps (all records, active + inactive) for table rendering.
 * Populates form dropdowns with active items only.
 * Populates filter dropdowns with all items so old records can be filtered.
 */
async function loadDependencies() {
  try {
    const [machines, products, operators] = await Promise.all([
      MachinesAPI.getAll(),
      ProductsAPI.getAll(),
      OperatorsAPI.getAll(),
    ]);

    // Build lookup maps — include ALL items (active and inactive) so existing
    // records with deactivated resources still resolve correctly in the table.
    machineMap  = new Map(machines.map(m  => [String(m.id),  m]));
    productMap  = new Map(products.map(p  => [String(p.id),  p]));
    operatorMap = new Map(operators.map(o => [String(o.id),  o]));


    // Populate form dropdowns — active items only (can't create new records
    // referencing deactivated resources).
    populateSelect(
      'prod-field-machine',
      machines.filter(m => m.isActive !== false),
      m => ({ value: m.id, label: `${m.code} — ${m.name}` }),
      'Seleccionar máquina…'
    );

    populateSelect(
      'prod-field-product',
      products.filter(p => p.active !== false),
      p => ({ value: p.id, label: p.name }),
      'Seleccionar producto…'
    );

    populateSelect(
      'prod-field-operator',
      operators.filter(o => o.isActive !== false),
      o => ({ value: o.id, label: o.name }),
      'Seleccionar operario…'
    );

    // Populate filter dropdowns — all items so filters can reference old records
    populateSelect(
      'prod-filter-machine',
      machines,
      m => ({ value: m.id, label: `${m.code} — ${m.name}` }),
      null  // no placeholder — first option is "Todas las máquinas" from HTML
    );

    populateSelect(
      'prod-filter-product',
      products,
      p => ({ value: p.id, label: p.name }),
      null  // no placeholder — first option is "Todos los productos" from HTML
    );

    // Operator filter — active operators only, sorted alphabetically by name.
    // Uses operatorMap source data; inactive operators are excluded so the filter
    // list stays clean while historical records (which may reference them) remain
    // fully visible when no operator filter is active.
    const activeOperatorsSorted = operators
      .filter(o => o.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    populateSelect(
      'prod-filter-operator',
      activeOperatorsSorted,
      o => ({ value: o.id, label: o.name }),
      null  // no placeholder — first option is "Todos los operarios" from HTML
    );

  } catch (err) {
    showFeedback(`Error cargando datos de referencia: ${err.message}`, 'error');
  }
}

/**
 * Populate a <select> element with an array of items.
 * Preserves the current selection if still valid after repopulation.
 * @param {string}      selectId     - DOM id of the <select>
 * @param {Array}       items        - Data array
 * @param {Function}    mapper       - (item) => { value, label }
 * @param {string|null} placeholder  - First disabled option text, or null to skip
 */
function populateSelect(selectId, items, mapper, placeholder) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const currentValue = select.value;

  // Keep only the first option (placeholder or "all" option), rebuild the rest
  while (select.options.length > 1) select.remove(1);

  if (placeholder && select.options.length === 0) {
    const opt = document.createElement('option');
    opt.value    = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = placeholder;
    select.appendChild(opt);
  }

  items.forEach(item => {
    const { value, label } = mapper(item);
    const opt = document.createElement('option');
    opt.value       = value;
    opt.textContent = label;
    select.appendChild(opt);
  });

  // Restore prior selection if still valid
  if (currentValue) select.value = currentValue;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

/**
 * Fetch all production records, store in memory, and re-apply active filters.
 * Called on mount and after every create / update / delete.
 */
async function loadRecords() {
  showTableLoading(true);

  try {
    allRecords = await ProductionAPI.getAll();
    applyFilters();
  } catch (err) {
    showFeedback(`Error al cargar registros: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

/**
 * Render an array of production records into the table body.
 * Called exclusively by applyFilters().
 * @param {Array} records
 */
function renderTable(records) {
  showTableLoading(false);

  const tbody   = document.getElementById('production-tbody');
  const empty   = document.getElementById('production-table-empty');
  const wrapper = document.getElementById('production-table-wrapper');

  if (!records || records.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  tbody.innerHTML = records.map(buildTableRow).join('');

  tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => handleEdit(btn.dataset.id));
  });

  tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
}

/**
 * Build a single <tr> HTML string for a production record.
 * Uses lookup maps for resource names — deactivated items still resolve via
 * map fallback so no historical record becomes unreadable.
 * @param {Object} record
 * @returns {string}
 */
function buildTableRow(record) {
  // Resolve resource names — fallback gracefully if item was hard-deleted
  const machine  = machineMap.get(String(record.machineId));
  const product  = productMap.get(String(record.productId));
  const operator = operatorMap.get(String(record.operatorId));

  const machineName = machine
    ? `<span class="machine-code">${escapeHTML(machine.code)}</span> ${escapeHTML(machine.name)}`
    : `<span class="text-muted">[Máquina eliminada]</span>`;

  const productName = product
    ? escapeHTML(product.name)
    : `<span class="text-muted">[Producto eliminado]</span>`;

  const operatorName = operator
    ? escapeHTML(operator.name)
    : `<span class="text-muted">[Operario eliminado]</span>`;

  const dateFormatted = formatDate(record.productionDate);

  const shiftClass = {
    'Matutino':   'badge--blue',
    'Vespertino': 'badge--teal',
    'Nocturno':   'badge--gray',
  }[record.shift] || 'badge--gray';

  return `
    <tr class="table-row">
      <td class="td-date">${escapeHTML(dateFormatted)}</td>
      <td class="td-machine">${machineName}</td>
      <td>${productName}</td>
      <td class="text-right td-quantity">${formatNumber(record.quantity)}</td>
      <td><span class="badge ${shiftClass}">${escapeHTML(record.shift || '—')}</span></td>
      <td>${operatorName}</td>
      <td class="text-center td-actions">
        <button
          class="btn btn--ghost btn--xs"
          data-action="edit"
          data-id="${record.id}"
          title="Editar registro"
        >✎ Editar</button>
        <button
          class="btn btn--danger btn--xs"
          data-action="delete"
          data-id="${record.id}"
          title="Eliminar registro"
        >✕ Eliminar</button>
      </td>
    </tr>
  `;
}

// ─── Form Interactions ────────────────────────────────────────────────────────

/** Attach all form-level, filter, and action listeners. */
function attachFormListeners() {
  document.getElementById('production-form')
    .addEventListener('submit', handleFormSubmit);

  document.getElementById('production-cancel-btn')
    .addEventListener('click', resetFormToCreateMode);


  // Filter controls — all route through the same coordinator
  document.getElementById('prod-filter-date-from')
    .addEventListener('change', applyFilters);
  document.getElementById('prod-filter-date-to')
    .addEventListener('change', applyFilters);
  document.getElementById('prod-filter-machine')
    .addEventListener('change', applyFilters);
  document.getElementById('prod-filter-product')
    .addEventListener('change', applyFilters);
  document.getElementById('prod-filter-operator')
    .addEventListener('change', applyFilters);

  // Clear filters button
  document.getElementById('production-clear-filters-btn')
    .addEventListener('click', clearFilters);
}

/**
 * Handle form submission for both create and edit modes.
 *
 * SNAPSHOT LOGIC (create only):
 *   The operator rate from the form input is stamped as operatorRateSnapshot.
 *   This value is then frozen by the adapter's update() method forever after.
 *
 * DUPLICATE RECORD RULE (create and edit):
 *   Before saving, scan allRecords for any record that shares the same combination
 *   of operatorId + productionDate + machineId + productId.
 *   In edit mode the record being edited is excluded from the scan so a no-change
 *   save on an unchanged record does not falsely trigger this check.
 *   An operator may produce different products on the same machine on the same day;
 *   only the exact four-field combination is blocked.
 *
 * @param {Event} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) return;

  const submitBtn = document.getElementById('production-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    const payload = collectFormData();

    // ── Duplicate check — runs for both create and edit ─────────────────────
    // In edit mode, skip the record currently being edited (self-comparison).
    const conflict = allRecords.find(r =>
      String(r.operatorId) === String(payload.operatorId) &&
      r.productionDate     === payload.productionDate     &&
      String(r.machineId)  === String(payload.machineId)  &&
      String(r.productId)  === String(payload.productId)  &&
      !(editingRecord && String(r.id) === String(editingRecord.id))
    );

    if (conflict) {
      showFeedback(
        'Ya existe un registro de producción para este operario, máquina, producto y fecha.',
        'error'
      );
      setButtonLoading(submitBtn, false);
      return;
    }

    if (editingRecord) {
      // ── Edit mode → update (snapshots are protected in the adapter)

      // ── Compute inventory delta between old and new record ────────
      // Production records ADD stock on create, so:
      //   oldItem loses  editingRecord.quantity  (reverse old credit)
      //   newItem gains  payload.quantity         (apply new credit)
      // If same product, net delta = newQty − oldQty.
      const oldProduct = productMap.get(String(editingRecord.productId));
      const newProduct = productMap.get(String(payload.productId));

      const oldInvItemId = (oldProduct && oldProduct.type === 'manufactured')
        ? await ensureProductInventoryItem(oldProduct) : null;
      const newInvItemId = (newProduct && newProduct.type === 'manufactured')
        ? await ensureProductInventoryItem(newProduct) : null;

      // Build delta map: inventoryItemId → net quantity change
      const deltaMap = new Map();
      if (oldInvItemId) {
        deltaMap.set(oldInvItemId, (deltaMap.get(oldInvItemId) || 0) - editingRecord.quantity);
      }
      if (newInvItemId) {
        deltaMap.set(newInvItemId, (deltaMap.get(newInvItemId) || 0) + payload.quantity);
      }

      // Validate: negative deltas (stock removal) require sufficient available stock
      for (const [itemId, delta] of deltaMap) {
        if (delta >= 0) continue;  // adding stock — always safe
        const item = await InventoryAPI.getById(itemId);
        if (item && item.stock < Math.abs(delta)) {
          showFeedback(
            `No se puede reducir: stock insuficiente de "${item.name}". ` +
            `Disponible: ${item.stock}, se necesita devolver: ${Math.abs(delta)}.`,
            'error', 6000
          );
          setButtonLoading(submitBtn, false);
          return;
        }
      }

      // ── Save the record (snapshots protected by adapter) ──────────
      await ProductionAPI.update(editingRecord.id, payload);

      // ── Apply inventory deltas ────────────────────────────────────
      for (const [itemId, delta] of deltaMap) {
        if (delta > 0) {
          await InventoryAPI.addStock(itemId, delta, editingRecord.id,
            'Ajuste por edición de producción');
        } else if (delta < 0) {
          await InventoryAPI.removeStock(itemId, Math.abs(delta), editingRecord.id,
            'Ajuste por edición de producción');
        }
      }

      showFeedback('Producción actualizada y stock ajustado correctamente.', 'success');

    } else {
      // ── Create mode ────────────────────────────────────────────────────────

      // Resolve product once — used for type validation and inventory link
      const product = productMap.get(String(payload.productId));

      // operatorRateSnapshot is already in payload from collectFormData()

      // ── Validate product is manufactured ───────────────────────────────────
      if (!product || product.type !== 'manufactured') {
        showFeedback(
          'Solo los productos de tipo "Fabricado" pueden registrarse en producción.',
          'error'
        );
        setButtonLoading(submitBtn, false);
        return;
      }

      // ── Resolve finished-goods inventory item (auto-creates if absent) ───
      const finishedItemId = await ensureProductInventoryItem(product);

      // ── Save the production record ───────────────────────────────────────
      const newRecord = await ProductionAPI.create(payload);

      // ── Add finished goods stock (no raw-material deductions) ────────────
      await InventoryAPI.addStock(
        finishedItemId,
        payload.quantity,
        newRecord.id,           // referenceId — links movement to this production record
        'Salida de producción'  // note
      );

      showFeedback('Producción registrada y stock actualizado correctamente.', 'success');
    }

    resetFormToCreateMode();
    await loadRecords();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

/**
 * Populate the form with a record's data and switch to edit mode.
 * Snapshot values are displayed read-only in the snapshot info panel.
 * The operator dropdown is set to the record's operatorId.
 * @param {string} recordId
 */
function handleEdit(recordId) {
  const record = allRecords.find(r => String(r.id) === String(recordId));
  if (!record) return;

  editingRecord = record;

  // Populate editable fields
  document.getElementById('prod-field-id').value       = record.id;
  document.getElementById('prod-field-machine').value  = record.machineId    || '';
  document.getElementById('prod-field-product').value  = record.productId    || '';
  document.getElementById('prod-field-quantity').value = record.quantity      || '';
  document.getElementById('prod-field-shift').value    = record.shift         || '';
  document.getElementById('prod-field-operator').value = record.operatorId   || '';
  document.getElementById('prod-field-rate').value     = record.operatorRateSnapshot       || '';
  document.getElementById('prod-field-weight').value   = record.weightPerPackageSnapshot   || '';
  document.getElementById('prod-field-date').value     = record.productionDate || '';

  // Show snapshot info panel (read-only display)
  document.getElementById('prod-snapshot-rate-display').textContent =
    formatCurrency(record.operatorRateSnapshot);
  document.getElementById('prod-snapshot-panel').style.display = '';

  // Update form chrome
  document.getElementById('production-form-title').innerHTML = `
    <span class="card__title-icon">✎</span>
    Editar Registro
  `;
  document.getElementById('production-submit-btn').innerHTML =
    '<span class="btn__icon">✔</span> Guardar Cambios';
  document.getElementById('production-cancel-btn').style.display = 'inline-flex';

  document.getElementById('production-form-card').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Delete a production record after confirmation.
 *
 * INVENTORY REVERSAL:
 *   On create, addStock credited finished-goods inventory for this record's
 *   quantity. On delete we reverse that credit via removeStock. If part of
 *   the stock was already consumed by sales, we remove only what's available
 *   and warn the user about the remainder.
 *
 * @param {string} recordId
 */
async function handleDelete(recordId) {
  const record = allRecords.find(r => String(r.id) === String(recordId));
  if (!record) return;

  if (!confirm(
    '¿Estás seguro de que deseas eliminar este registro?\n\n' +
    'Se revertirá el stock del inventario de producto terminado.\n' +
    'Esta acción no se puede deshacer.'
  )) {
    return;
  }

  try {
    // ── Reverse inventory credit ──────────────────────────────────
    const product = productMap.get(String(record.productId));
    if (product && product.type === 'manufactured') {
      const invItemId = await ensureProductInventoryItem(product);
      const item      = await InventoryAPI.getById(invItemId);
      if (item) {
        const reverseQty = Math.min(record.quantity, item.stock);
        if (reverseQty > 0) {
          await InventoryAPI.removeStock(
            invItemId, reverseQty, recordId,
            'Reverso por eliminación de registro de producción'
          );
        }
        if (reverseQty < record.quantity) {
          showFeedback(
            `Solo se revirtieron ${reverseQty} de ${record.quantity} unidades del inventario ` +
            `(el resto ya fue consumido por ventas).`,
            'warning', 6000
          );
        }
      }
    }

    // ── Delete the production record ──────────────────────────────
    await ProductionAPI.remove(recordId);
    showFeedback('Registro de producción eliminado y stock ajustado.', 'success');

    if (editingRecord && String(editingRecord.id) === String(recordId)) {
      resetFormToCreateMode();
    }

    await loadRecords();
  } catch (err) {
    showFeedback(`Error al eliminar: ${err.message}`, 'error');
  }
}

/** Reset the form to "create new record" mode. */
function resetFormToCreateMode() {
  editingRecord = null;

  document.getElementById('production-form').reset();
  document.getElementById('prod-field-id').value     = '';
  // Restore default rate after reset() clears it — user can still edit freely
  document.getElementById('prod-field-rate').value   = 70;
  // Restore default weight after reset() clears it — average morning weigh-in
  document.getElementById('prod-field-weight').value = 13;

  // Hide snapshot panel — only shown during edit
  document.getElementById('prod-snapshot-panel').style.display = 'none';

  // Restore form chrome
  document.getElementById('production-form-title').innerHTML = `
    <span class="card__title-icon">+</span>
    Nuevo Registro
  `;
  document.getElementById('production-submit-btn').innerHTML =
    '<span class="btn__icon">＋</span> Guardar Registro';
  document.getElementById('production-cancel-btn').style.display = 'none';

  clearFormErrors();
}

// ─── Filter Coordinator ────────────────────────────────────────────────────────

/**
 * Read all five filter controls, apply them cumulatively to allRecords,
 * update the count badge, and re-render the table.
 *
 * Filters applied:
 *   1. Date from   (inclusive, compared as YYYY-MM-DD strings)
 *   2. Date to     (inclusive)
 *   3. Machine ID  (exact match)
 *   4. Product ID  (exact match)
 *   5. Operator ID (exact match)
 *
 * State is persisted in `activeFilters` so loadRecords() restores them.
 */
function applyFilters() {
  activeFilters.dateFrom   = document.getElementById('prod-filter-date-from')?.value    || '';
  activeFilters.dateTo     = document.getElementById('prod-filter-date-to')?.value      || '';
  activeFilters.machineId  = document.getElementById('prod-filter-machine')?.value      || '';
  activeFilters.productId  = document.getElementById('prod-filter-product')?.value      || '';
  activeFilters.operatorId = document.getElementById('prod-filter-operator')?.value     || '';

  let results = allRecords;

  if (activeFilters.dateFrom) {
    results = results.filter(r => r.productionDate >= activeFilters.dateFrom);
  }
  if (activeFilters.dateTo) {
    results = results.filter(r => r.productionDate <= activeFilters.dateTo);
  }
  if (activeFilters.machineId) {
    results = results.filter(r => String(r.machineId) === activeFilters.machineId);
  }
  if (activeFilters.productId) {
    results = results.filter(r => String(r.productId) === activeFilters.productId);
  }
  if (activeFilters.operatorId) {
    results = results.filter(r => String(r.operatorId) === activeFilters.operatorId);
  }

  const isFiltered = activeFilters.dateFrom  || activeFilters.dateTo   ||
                     activeFilters.machineId  || activeFilters.productId ||
                     activeFilters.operatorId;

  updateCountBadge(allRecords.length, isFiltered ? results.length : null);
  renderTable(results);
}

/** Reset all filter controls and re-render with the full dataset. */
function clearFilters() {
  activeFilters = { dateFrom: '', dateTo: '', machineId: '', productId: '', operatorId: '' };

  const safeSet = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  safeSet('prod-filter-date-from', '');
  safeSet('prod-filter-date-to',   '');
  safeSet('prod-filter-machine',   '');
  safeSet('prod-filter-product',   '');
  safeSet('prod-filter-operator',  '');

  updateCountBadge(allRecords.length, null);
  renderTable(allRecords);
}

// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Validate all required fields.
 * Shows a summary toast on the first failure and marks individual fields inline.
 * @returns {boolean} true if the form is valid and safe to submit
 */
function validateForm() {
  clearFormErrors();
  const errors = [];

  const machineId  = document.getElementById('prod-field-machine').value;
  const productId  = document.getElementById('prod-field-product').value;
  const quantity   = document.getElementById('prod-field-quantity').value;
  const shift      = document.getElementById('prod-field-shift').value;
  const operatorId = document.getElementById('prod-field-operator').value;
  const rate       = document.getElementById('prod-field-rate').value;
  const weight     = document.getElementById('prod-field-weight').value;
  const date       = document.getElementById('prod-field-date').value;

  if (!machineId) {
    showFieldError('prod-error-machine',   'Selecciona una máquina.');
    errors.push('máquina');
  }
  if (!productId) {
    showFieldError('prod-error-product',   'Selecciona un producto.');
    errors.push('producto');
  }
  if (!quantity || Number(quantity) < 1) {
    showFieldError('prod-error-quantity',  'La cantidad debe ser mayor a 0.');
    errors.push('cantidad');
  }
  if (!shift) {
    showFieldError('prod-error-shift',     'Selecciona el turno.');
    errors.push('turno');
  }
  if (!operatorId) {
    showFieldError('prod-error-operator',  'Selecciona un operario.');
    errors.push('operario');
  }
  if (!rate || Number(rate) <= 0) {
    showFieldError('prod-error-rate',      'La tarifa debe ser mayor a 0.');
    errors.push('tarifa');
  }
  if (!weight || Number(weight) <= 0) {
    showFieldError('prod-error-weight',    'El peso debe ser mayor a 0.');
    errors.push('peso');
  }
  if (!date) {
    showFieldError('prod-error-date',      'La fecha de producción es obligatoria.');
    errors.push('fecha');
  }

  if (errors.length > 0) {
    showFeedback(
      `Error de validación: verifica los campos obligatorios (${errors.join(', ')}).`,
      'error'
    );
    return false;
  }

  return true;
}

/** Clear all inline form error messages. */
function clearFormErrors() {
  document.querySelectorAll('#production-form .form-error')
    .forEach(el => (el.textContent = ''));
  document.querySelectorAll('#production-form .form-input')
    .forEach(el => el.classList.remove('form-input--error'));
}

/**
 * Display an error message beneath a specific field.
 * @param {string} errorId
 * @param {string} message
 */
function showFieldError(errorId, message) {
  const el = document.getElementById(errorId);
  if (el) el.textContent = message;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


/**
 * Collect form values into a production record payload.
 *
 * operatorRateSnapshot is stamped here from the form input.
 *
 * @returns {Object}
 */
function collectFormData() {
  return {
    machineId:            document.getElementById('prod-field-machine').value,
    productId:            document.getElementById('prod-field-product').value,
    quantity:             parseInt(document.getElementById('prod-field-quantity').value, 10),
    shift:                document.getElementById('prod-field-shift').value,
    operatorId:           document.getElementById('prod-field-operator').value,
    // operatorRateSnapshot: stamped at creation from the form, never recalculated
    operatorRateSnapshot:      parseFloat(document.getElementById('prod-field-rate').value)   || 0,
    // weightPerPackageSnapshot: morning weigh-in snapshot, never recalculated
    weightPerPackageSnapshot:  parseFloat(document.getElementById('prod-field-weight').value) || 0,
    productionDate:       document.getElementById('prod-field-date').value,
  };
}

/**
 * Show/hide the table loading spinner.
 * @param {boolean} loading
 */
function showTableLoading(loading) {
  document.getElementById('production-table-loading').style.display  = loading ? 'flex'  : 'none';
  document.getElementById('production-table-wrapper').style.display  = loading ? 'none'  : '';
  document.getElementById('production-table-empty').style.display    = 'none';
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
 * Update the records count badge in the module header.
 * Shows "X de Y registros" when filters are active.
 * @param {number}      total
 * @param {number|null} [filtered]  - null = unfiltered, show only total
 */
function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('production-count-badge');
  if (!badge) return;

  if (filtered !== null && filtered !== total) {
    badge.textContent = `${filtered} de ${total} registro${total !== 1 ? 's' : ''}`;
  } else {
    badge.textContent = `${total} registro${total !== 1 ? 's' : ''}`;
  }
}

/**
 * Put a button in a loading/disabled state while an async operation runs.
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
 * Format a number as Dominican Peso currency (RD$).
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('es-DO', {
    style:                 'currency',
    currency:              'DOP',
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * Format an integer with locale-aware thousands separator.
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO').format(value);
}

/**
 * Format a YYYY-MM-DD date string as a human-readable Spanish date.
 * e.g. "2024-03-15" → "15 mar 2024"
 * Appends T00:00:00 to force local-timezone parsing and avoid UTC date shift.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
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

// ─── Scoped Styles ────────────────────────────────────────────────────────────

(function injectProductionStyles() {
  if (document.getElementById('production-module-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'production-module-styles';
  tag.textContent = `

  `;
  document.head.appendChild(tag);
}());