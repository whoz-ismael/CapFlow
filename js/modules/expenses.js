/**
 * expenses.js — CapFlow Expenses Module
 *
 * Manages factory operating expenses:
 *   - CRUD for expense records (date, category, description, amount, method)
 *   - Attachment upload (PDF / image) stored as base64 DataURL
 *   - Filter by date range, category, and payment method
 *   - Running totals in the table footer
 *
 * Expense categories are used by the Reports module to compute manufacturing
 * overhead (OVERHEAD_CATEGORIES in reports.js). If categories are renamed here,
 * update reports.js accordingly.
 *
 * Data source: api.js -> ExpensesAPI (Supabase).
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

import { ExpensesAPI, InvestorAPI } from '../api.js';

// --- Constants ---------------------------------------------------------------

/**
 * Master list of expense categories.
 * Exported so reports.js can build its filter dropdown.
 * @type {{ label: string }[]}
 */
export const EXPENSE_CATEGORIES = [
  // Manufacturing overhead (matched by reports.js OVERHEAD_CATEGORIES)
  { label: 'Electricidad' },
  { label: 'Alquiler \u2014 F\u00e1brica' },
  { label: 'Alquiler \u2014 \u00c1rea de lavado' },
  { label: 'Mantenimiento y reparaciones' },
  { label: 'Agua potable (operarios)' },
  { label: 'Materiales de limpieza' },
  { label: 'Equipos y herramientas' },

  // General operating expenses
  { label: 'Transporte y fletes' },
  { label: 'Combustible' },
  { label: 'Alimentaci\u00f3n de operarios' },
  { label: 'Seguros' },
  { label: 'Impuestos y tasas' },
  { label: 'Servicios profesionales' },
  { label: 'Suministros de oficina' },
  { label: 'Telecomunicaciones' },
  { label: 'Otros gastos' },
];

/** Payment method options for the form dropdown. */
const PAYMENT_METHODS = [
  { value: 'cash',     label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia bancaria' },
  { value: 'card',     label: 'Tarjeta de cr\u00e9dito' },
  { value: 'check',    label: 'Cheque' },
];

const METHOD_LABELS = new Map(PAYMENT_METHODS.map(m => [m.value, m.label]));

const MAX_ATTACH    = 3;
const MAX_ATTACH_MB = 1.5;

// --- Module State ------------------------------------------------------------

let editingExpense     = null;
let allExpenses        = [];
let currentAttachments = [];
let investorRecord     = null;

let filterDateFrom  = '';
let filterDateTo    = '';
let filterCategory  = '';
let filterMethod    = '';
let searchQuery     = '';

// --- Entry Point -------------------------------------------------------------

export async function mountExpenses(container) {
  container.innerHTML = buildModuleHTML();
  injectStyles();
  attachFormListeners();
  await loadExpenses();
}

// --- HTML Builder ------------------------------------------------------------

function buildModuleHTML() {
  const today = todayString();
  const categoryOptions = EXPENSE_CATEGORIES.map(c =>
    `<option value="${escapeHTML(c.label)}">${escapeHTML(c.label)}</option>`
  ).join('');
  const methodOptions = PAYMENT_METHODS.map(m =>
    `<option value="${escapeHTML(m.value)}">${escapeHTML(m.label)}</option>`
  ).join('');

  return `
    <section class="module" id="expenses-module">

      <!-- Page Header -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">\u25ce</span>
          <div>
            <h1 class="module-header__title">Gastos</h1>
            <p class="module-header__subtitle">Registro y control de gastos operativos</p>
          </div>
        </div>
        <div class="module-header__badge" id="expenses-count-badge">\u2014 gastos</div>
      </header>

      <!-- Expense Form Card -->
      <div class="card" id="expenses-form-card">
        <div class="card__header">
          <h2 class="card__title" id="expenses-form-title">
            <span class="card__title-icon">+</span>
            Nuevo Gasto
          </h2>
          <button class="btn btn--ghost btn--sm" id="expenses-cancel-btn" style="display:none;">
            \u2715 Cancelar
          </button>
        </div>

        <form id="expenses-form" novalidate>
          <input type="hidden" id="exp-field-id">

          <div class="form-grid">
            <!-- Fecha -->
            <div class="form-group">
              <label class="form-label" for="exp-field-date">
                Fecha <span class="required">*</span>
              </label>
              <input class="form-input" type="date" id="exp-field-date"
                     value="${escapeHTML(today)}" required>
              <span class="form-error" id="exp-error-date"></span>
            </div>

            <!-- Categoria -->
            <div class="form-group">
              <label class="form-label" for="exp-field-category">
                Categor\u00eda <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="exp-field-category" required>
                  <option value="" disabled selected>Seleccionar\u2026</option>
                  ${categoryOptions}
                </select>
              </div>
              <span class="form-error" id="exp-error-category"></span>
            </div>

            <!-- Metodo de pago -->
            <div class="form-group">
              <label class="form-label" for="exp-field-method">
                M\u00e9todo de pago <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="exp-field-method" required>
                  <option value="" disabled selected>Seleccionar\u2026</option>
                  ${methodOptions}
                </select>
              </div>
              <span class="form-error" id="exp-error-method"></span>
            </div>

            <!-- Monto -->
            <div class="form-group">
              <label class="form-label" for="exp-field-amount">
                Monto (RD$) <span class="required">*</span>
              </label>
              <input class="form-input" type="number" id="exp-field-amount"
                     min="0.01" step="0.01" placeholder="0.00" required>
              <span class="form-error" id="exp-error-amount"></span>
            </div>

            <!-- Descripcion -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="exp-field-description">
                Descripci\u00f3n <span class="required">*</span>
              </label>
              <input class="form-input" type="text" id="exp-field-description"
                     placeholder="Ej: Factura el\u00e9ctrica marzo 2026" maxlength="200" required>
              <span class="form-error" id="exp-error-description"></span>
            </div>

            <!-- Notas -->
            <div class="form-group form-group--wide">
              <label class="form-label" for="exp-field-notes">Notas (opcional)</label>
              <textarea class="form-input" id="exp-field-notes" rows="2"
                        placeholder="Observaciones adicionales\u2026" maxlength="500"></textarea>
            </div>
          </div>

          <!-- Investor Financing (shown only when an investor record exists) -->
          <div class="exp-investor-section" id="exp-investor-section" style="display:none;">
            <label class="exp-investor-toggle">
              <input type="checkbox" id="exp-investor-check">
              <span class="exp-investor-toggle-label">
                <strong>Financiado por el inversionista</strong>
                <span class="form-hint" style="margin:0;">El monto se sumará a la deuda del inversionista</span>
              </span>
            </label>
            <div id="exp-investor-fields" style="display:none;" class="form-grid exp-investor-fields">
              <div class="form-group">
                <label class="form-label" for="exp-investor-amount">
                  Monto financiado (RD$) <span class="required">*</span>
                </label>
                <input class="form-input" type="number" id="exp-investor-amount"
                       min="0.01" step="0.01" placeholder="0.00">
                <span class="form-error" id="exp-investor-error"></span>
              </div>
              <div class="form-group">
                <label class="form-label" for="exp-investor-note">Nota (opcional)</label>
                <input class="form-input" type="text" id="exp-investor-note" maxlength="120"
                       placeholder="Ej: Préstamo para pago de electricidad">
              </div>
            </div>
          </div>

          <!-- Attachments -->
          <div class="exp-attach-section">
            <div class="exp-attach-header">
              <span class="form-label" style="margin:0;">Comprobantes (m\u00e1x. ${MAX_ATTACH}, ${MAX_ATTACH_MB} MB c/u)</span>
              <label class="btn btn--ghost btn--sm" for="exp-file-input" style="cursor:pointer;">
                + Adjuntar archivo
              </label>
              <input type="file" id="exp-file-input" accept="image/*,application/pdf"
                     multiple style="display:none;">
            </div>
            <div class="exp-attach-list" id="exp-attach-list">
              <p class="form-hint" style="margin:0;">Sin archivos adjuntos.</p>
            </div>
          </div>

          <!-- Form Actions -->
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="expenses-submit-btn">
              <span class="btn__icon">\uff0b</span>
              Registrar Gasto
            </button>
          </div>
        </form>
      </div>

      <!-- Filters + Table Card -->
      <div class="card" id="expenses-table-card">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">\u2630</span>
            Listado de Gastos
          </h2>
        </div>

        <!-- Filters -->
        <div class="exp-filters">
          <div class="form-group" style="flex:0 0 auto;">
            <label class="form-label" for="exp-filter-from">Desde</label>
            <input class="form-input form-input--sm" type="date" id="exp-filter-from">
          </div>
          <div class="form-group" style="flex:0 0 auto;">
            <label class="form-label" for="exp-filter-to">Hasta</label>
            <input class="form-input form-input--sm" type="date" id="exp-filter-to">
          </div>
          <div class="form-group" style="flex:0 0 auto;">
            <label class="form-label" for="exp-filter-category">Categor\u00eda</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="exp-filter-category">
                <option value="">Todas</option>
                ${categoryOptions}
              </select>
            </div>
          </div>
          <div class="form-group" style="flex:0 0 auto;">
            <label class="form-label" for="exp-filter-method">M\u00e9todo</label>
            <div class="select-wrapper">
              <select class="form-input form-select form-input--sm" id="exp-filter-method">
                <option value="">Todos</option>
                ${methodOptions}
              </select>
            </div>
          </div>
          <div class="form-group" style="flex:1 1 auto;">
            <label class="form-label" for="exp-search">Buscar</label>
            <input class="form-input form-input--sm" type="search" id="exp-search"
                   placeholder="Buscar en descripci\u00f3n\u2026" aria-label="Buscar gasto">
          </div>
        </div>

        <!-- Loading state -->
        <div class="table-loading" id="exp-table-loading">
          <div class="spinner"></div>
          <span>Cargando gastos\u2026</span>
        </div>

        <!-- Empty state -->
        <div class="table-empty" id="exp-table-empty" style="display:none;">
          <span class="table-empty__icon">\ud83d\udcc2</span>
          <p>No hay gastos registrados a\u00fan.</p>
          <p class="table-empty__sub">Registra el primero usando el formulario de arriba.</p>
        </div>

        <!-- Table -->
        <div class="table-wrapper" id="exp-table-wrapper" style="display:none;">
          <table class="data-table" id="expenses-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categor\u00eda</th>
                <th>Descripci\u00f3n</th>
                <th class="text-right">Monto</th>
                <th>M\u00e9todo</th>
                <th class="text-center">Adj.</th>
                <th class="text-center">Acciones</th>
              </tr>
            </thead>
            <tbody id="expenses-tbody"></tbody>
            <tfoot id="expenses-tfoot"></tfoot>
          </table>
        </div>
      </div>
    </section>
  `;
}

// --- Data Loading ------------------------------------------------------------

async function loadExpenses() {
  showTableLoading(true);
  try {
    [allExpenses, investorRecord] = await Promise.all([
      ExpensesAPI.getAll(),
      InvestorAPI.get().catch(() => null),
    ]);
    renderInvestorSection();
    applyFilters();
  } catch (err) {
    showFeedback(`Error al cargar gastos: ${err.message}`, 'error');
    showTableLoading(false);
  }
}

// --- Table Rendering ---------------------------------------------------------

function renderTable(expenses) {
  showTableLoading(false);

  const tbody   = document.getElementById('expenses-tbody');
  const tfoot   = document.getElementById('expenses-tfoot');
  const empty   = document.getElementById('exp-table-empty');
  const wrapper = document.getElementById('exp-table-wrapper');

  if (!expenses || expenses.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';

  // Sort newest first
  const sorted = [...expenses].sort((a, b) =>
    (b.expenseDate || '').localeCompare(a.expenseDate || ''));

  tbody.innerHTML = sorted.map(buildTableRow).join('');

  // Footer totals
  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  tfoot.innerHTML = `
    <tr style="font-weight:600;">
      <th colspan="3" class="text-right">Total</th>
      <th class="text-right">${formatCurrency(total)}</th>
      <th colspan="3"></th>
    </tr>
  `;

  // Row action listeners
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => handleEdit(btn.dataset.id)));
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.id)));
  tbody.querySelectorAll('[data-action="view-attach"]').forEach(btn =>
    btn.addEventListener('click', () => {
      const exp = allExpenses.find(e => String(e.id) === String(btn.dataset.id));
      if (exp) viewAttachments(exp.attachments || []);
    }));
}

function buildTableRow(expense) {
  const methodLabel = METHOD_LABELS.get(expense.method) || expense.method || '\u2014';
  const attCount    = (expense.attachments || []).length;
  const attBadge    = attCount > 0
    ? `<span class="badge badge--blue" style="cursor:pointer;"
         data-action="view-attach" data-id="${expense.id}">\ud83d\udcce ${attCount}</span>`
    : '<span style="color:var(--color-text-muted);">\u2014</span>';
  const invBadge    = expense.investorFinancing
    ? `<span class="badge badge--orange" style="font-size:0.75rem;" title="Financiado por el inversionista: ${formatCurrency(expense.investorFinancing.amount)}">◈ INV</span>`
    : '';

  return `
    <tr class="table-row">
      <td style="white-space:nowrap;">${escapeHTML(formatDate(expense.expenseDate))}</td>
      <td><span class="badge badge--teal" style="font-size:0.78rem;">${escapeHTML(expense.category || '\u2014')}</span></td>
      <td>${escapeHTML(expense.description || '\u2014')}</td>
      <td class="text-right" style="font-family:var(--font-mono);white-space:nowrap;">${formatCurrency(expense.amount)}</td>
      <td><span class="badge badge--gray" style="font-size:0.78rem;">${escapeHTML(methodLabel)}</span>${invBadge ? ' ' + invBadge : ''}</td>
      <td class="text-center">${attBadge}</td>
      <td class="text-center td-actions">
        <button class="btn btn--ghost btn--xs" data-action="edit" data-id="${expense.id}"
                title="Editar gasto">\u270e Editar</button>
        <button class="btn btn--danger btn--xs" data-action="delete" data-id="${expense.id}"
                title="Eliminar gasto">\u2715 Eliminar</button>
      </td>
    </tr>
  `;
}

// --- Form Interactions -------------------------------------------------------

function attachFormListeners() {
  document.getElementById('expenses-form')
    .addEventListener('submit', handleFormSubmit);
  document.getElementById('expenses-cancel-btn')
    .addEventListener('click', resetFormToCreateMode);

  // Investor financing checkbox — show/hide amount fields
  document.getElementById('exp-investor-check')
    .addEventListener('change', e => {
      const fields  = document.getElementById('exp-investor-fields');
      fields.style.display = e.target.checked ? '' : 'none';
      if (e.target.checked) {
        // Pre-fill with current expense amount
        const amt = parseFloat(document.getElementById('exp-field-amount').value) || 0;
        const amtInput = document.getElementById('exp-investor-amount');
        if (!amtInput.value) amtInput.value = amt > 0 ? amt : '';
      }
    });

  // File input
  document.getElementById('exp-file-input')
    .addEventListener('change', e => handleFileInput(e.target.files));

  // Filters
  document.getElementById('exp-filter-from').addEventListener('change', applyFilters);
  document.getElementById('exp-filter-to').addEventListener('change', applyFilters);
  document.getElementById('exp-filter-category').addEventListener('change', applyFilters);
  document.getElementById('exp-filter-method').addEventListener('change', applyFilters);
  document.getElementById('exp-search').addEventListener('input', applyFilters);
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const submitBtn = document.getElementById('expenses-submit-btn');
  setButtonLoading(submitBtn, true);

  try {
    // Collect investor financing fields
    const investorChecked = document.getElementById('exp-investor-check')?.checked && investorRecord;
    const investorAmount  = investorChecked
      ? (parseFloat(document.getElementById('exp-investor-amount').value) || 0)
      : 0;
    const investorNote    = investorChecked
      ? document.getElementById('exp-investor-note').value.trim()
      : '';

    // Validate investor amount when checked
    if (investorChecked && investorAmount <= 0) {
      document.getElementById('exp-investor-error').textContent = 'El monto financiado debe ser mayor a 0.';
      setButtonLoading(submitBtn, false);
      return;
    }

    const investorFinancing = investorChecked
      ? { amount: investorAmount, note: investorNote }
      : null;

    const payload = {
      expenseDate:       document.getElementById('exp-field-date').value,
      category:          document.getElementById('exp-field-category').value,
      method:            document.getElementById('exp-field-method').value,
      amount:            parseFloat(document.getElementById('exp-field-amount').value) || 0,
      description:       document.getElementById('exp-field-description').value.trim(),
      notes:             document.getElementById('exp-field-notes').value.trim(),
      attachments:       [...currentAttachments],
      investorFinancing,
    };

    let savedExpense;
    if (editingExpense) {
      savedExpense = await ExpensesAPI.update(editingExpense.id, payload);
      showFeedback('Gasto actualizado correctamente.', 'success');
    } else {
      savedExpense = await ExpensesAPI.create(payload);
      showFeedback('Gasto registrado correctamente.', 'success');
    }

    // Sync investor debt: reconcile covers create, edit (delta), and removal
    if (investorRecord) {
      const expenseId  = savedExpense.id;
      const targetAmt  = investorFinancing ? investorFinancing.amount : 0;
      const noteForInv = investorNote || `Gasto: ${payload.description || expenseId}`;
      await InvestorAPI.reconcileInvestmentByRef(expenseId, targetAmt, noteForInv);
    }

    resetFormToCreateMode();
    await loadExpenses();

  } catch (err) {
    showFeedback(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

function handleEdit(expenseId) {
  const expense = allExpenses.find(e => String(e.id) === String(expenseId));
  if (!expense) return;

  editingExpense     = expense;
  currentAttachments = (expense.attachments || []).map(a => ({ ...a }));

  document.getElementById('exp-field-id').value          = expense.id;
  document.getElementById('exp-field-date').value        = expense.expenseDate || '';
  document.getElementById('exp-field-category').value    = expense.category || '';
  document.getElementById('exp-field-method').value      = expense.method || '';
  document.getElementById('exp-field-amount').value      = expense.amount || '';
  document.getElementById('exp-field-description').value = expense.description || '';
  document.getElementById('exp-field-notes').value       = expense.notes || '';

  // Populate investor financing fields if applicable
  const invCheck  = document.getElementById('exp-investor-check');
  const invFields = document.getElementById('exp-investor-fields');
  const invAmt    = document.getElementById('exp-investor-amount');
  const invNote   = document.getElementById('exp-investor-note');
  if (invCheck) {
    const fin = expense.investorFinancing;
    invCheck.checked         = !!fin;
    invFields.style.display  = fin ? '' : 'none';
    invAmt.value             = fin ? fin.amount : '';
    invNote.value            = fin ? (fin.note || '') : '';
  }

  renderAttachmentList();

  document.getElementById('expenses-form-title').innerHTML =
    '<span class="card__title-icon">\u270e</span> Editar Gasto';
  document.getElementById('expenses-submit-btn').innerHTML =
    '<span class="btn__icon">\u2714</span> Guardar Cambios';
  document.getElementById('expenses-cancel-btn').style.display = 'inline-flex';

  document.getElementById('expenses-form-card').scrollIntoView({ behavior: 'smooth' });
}

async function handleDelete(expenseId) {
  const expense = allExpenses.find(e => String(e.id) === String(expenseId));
  if (!expense) return;

  const label = expense.description || expense.category || 'este gasto';
  if (!confirm(`\u00bfEliminar "${label}"?\n\nEsta acci\u00f3n no se puede deshacer.`)) return;

  try {
    // Revert investor financing before deleting
    if (expense.investorFinancing && investorRecord) {
      await InvestorAPI.reconcileInvestmentByRef(
        expenseId, 0, `Reversión por eliminación de gasto: ${expense.description || expenseId}`
      );
    }

    await ExpensesAPI.remove(expenseId);
    showFeedback('Gasto eliminado.', 'success');

    if (editingExpense && String(editingExpense.id) === String(expenseId)) {
      resetFormToCreateMode();
    }

    await loadExpenses();
  } catch (err) {
    showFeedback(`Error al eliminar: ${err.message}`, 'error');
  }
}

function resetFormToCreateMode() {
  editingExpense     = null;
  currentAttachments = [];

  document.getElementById('expenses-form').reset();
  document.getElementById('exp-field-id').value   = '';
  document.getElementById('exp-field-date').value = todayString();

  // Reset investor financing section
  const invCheck  = document.getElementById('exp-investor-check');
  const invFields = document.getElementById('exp-investor-fields');
  if (invCheck)  invCheck.checked        = false;
  if (invFields) invFields.style.display = 'none';
  const invError = document.getElementById('exp-investor-error');
  if (invError)  invError.textContent    = '';

  renderAttachmentList();
  clearFormErrors();

  document.getElementById('expenses-form-title').innerHTML =
    '<span class="card__title-icon">+</span> Nuevo Gasto';
  document.getElementById('expenses-submit-btn').innerHTML =
    '<span class="btn__icon">\uff0b</span> Registrar Gasto';
  document.getElementById('expenses-cancel-btn').style.display = 'none';
  document.getElementById('exp-file-input').value = '';
}

// --- Investor Section ---------------------------------------------------------

/** Show or hide the investor financing section based on whether an investor is configured. */
function renderInvestorSection() {
  const section = document.getElementById('exp-investor-section');
  if (!section) return;
  section.style.display = investorRecord ? '' : 'none';
}

// --- Filter Coordinator ------------------------------------------------------

function applyFilters() {
  filterDateFrom = document.getElementById('exp-filter-from')?.value || '';
  filterDateTo   = document.getElementById('exp-filter-to')?.value || '';
  filterCategory = document.getElementById('exp-filter-category')?.value || '';
  filterMethod   = document.getElementById('exp-filter-method')?.value || '';
  searchQuery    = (document.getElementById('exp-search')?.value || '').trim().toLowerCase();

  let results = allExpenses;

  if (filterDateFrom) {
    results = results.filter(e => (e.expenseDate || '') >= filterDateFrom);
  }
  if (filterDateTo) {
    results = results.filter(e => (e.expenseDate || '') <= filterDateTo);
  }
  if (filterCategory) {
    results = results.filter(e => e.category === filterCategory);
  }
  if (filterMethod) {
    results = results.filter(e => e.method === filterMethod);
  }
  if (searchQuery) {
    results = results.filter(e =>
      (e.description || '').toLowerCase().includes(searchQuery) ||
      (e.notes || '').toLowerCase().includes(searchQuery)
    );
  }

  const isFiltered = filterDateFrom || filterDateTo || filterCategory ||
                     filterMethod || searchQuery;
  updateCountBadge(allExpenses.length, isFiltered ? results.length : null);
  renderTable(results);
}

// --- Attachment Management ---------------------------------------------------

function handleFileInput(files) {
  for (const file of files) {
    if (currentAttachments.length >= MAX_ATTACH) {
      showFeedback(`M\u00e1ximo ${MAX_ATTACH} archivos por gasto.`, 'warning');
      break;
    }
    if (file.size > MAX_ATTACH_MB * 1024 * 1024) {
      showFeedback(
        `"${file.name}" supera ${MAX_ATTACH_MB} MB. Los archivos deben ser peque\u00f1os.`,
        'warning', 7000
      );
      continue;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      currentAttachments.push({
        id:      `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name:    file.name, mime: file.type, size: file.size,
        dataUrl: ev.target.result,
      });
      renderAttachmentList();
    };
    reader.readAsDataURL(file);
  }
  document.getElementById('exp-file-input').value = '';
}

function renderAttachmentList() {
  const container = document.getElementById('exp-attach-list');
  if (!container) return;

  if (!currentAttachments.length) {
    container.innerHTML = '<p class="form-hint" style="margin:0;">Sin archivos adjuntos.</p>';
    return;
  }

  container.innerHTML = currentAttachments.map(att => `
    <div class="exp-attach-chip">
      <span class="exp-attach-icon">${att.mime === 'application/pdf' ? '\ud83d\udcc4' : '\ud83d\uddbc'}</span>
      <span class="exp-attach-name" title="${escapeHTML(att.name)}">${escapeHTML(att.name)}</span>
      <span class="exp-attach-size">${formatFileSize(att.size)}</span>
      <a href="${att.dataUrl}" target="_blank" rel="noopener"
         class="btn btn--ghost btn--xs">Ver</a>
      <button type="button" class="btn btn--danger btn--xs exp-attach-remove"
        data-att-id="${escapeHTML(att.id)}">\u2715</button>
    </div>
  `).join('');

  container.querySelectorAll('.exp-attach-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      currentAttachments = currentAttachments.filter(a => a.id !== btn.dataset.attId);
      renderAttachmentList();
    });
  });
}

function viewAttachments(attachments) {
  if (!attachments.length) return;
  if (attachments.length === 1) {
    window.open(attachments[0].dataUrl, '_blank', 'noopener');
    return;
  }
  const win = window.open('', '_blank', 'width=400,height=300,noopener');
  if (!win) return;
  const links = attachments.map(a =>
    `<li style="margin:8px 0;"><a href="${a.dataUrl}" target="_blank"
       style="font-family:sans-serif;color:#0057b8;">${escapeHTML(a.name)}</a></li>`
  ).join('');
  win.document.write(
    '<html><body style="padding:20px;background:#f8f8f8;">' +
    '<ul style="list-style:none;padding:0;">' + links + '</ul></body></html>'
  );
  win.document.close();
}

// --- Form Validation ---------------------------------------------------------

function validateForm() {
  clearFormErrors();
  let valid = true;

  if (!document.getElementById('exp-field-date').value) {
    showFieldError('exp-error-date', 'La fecha es obligatoria.');
    valid = false;
  }
  if (!document.getElementById('exp-field-category').value) {
    showFieldError('exp-error-category', 'Selecciona una categor\u00eda.');
    valid = false;
  }
  if (!document.getElementById('exp-field-method').value) {
    showFieldError('exp-error-method', 'Selecciona un m\u00e9todo de pago.');
    valid = false;
  }
  const amount = parseFloat(document.getElementById('exp-field-amount').value);
  if (!amount || amount <= 0) {
    showFieldError('exp-error-amount', 'El monto debe ser mayor a 0.');
    valid = false;
  }
  if (!document.getElementById('exp-field-description').value.trim()) {
    showFieldError('exp-error-description', 'La descripci\u00f3n es obligatoria.');
    valid = false;
  }

  return valid;
}

function clearFormErrors() {
  document.querySelectorAll('#expenses-form .form-error')
    .forEach(el => (el.textContent = ''));
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

// --- Helpers -----------------------------------------------------------------

function todayString() { return new Date().toISOString().slice(0, 10); }

function formatDate(s) {
  if (!s) return '\u2014';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function formatCurrency(n) {
  return 'RD$ ' + new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  return bytes < 1048576
    ? (bytes / 1024).toFixed(1) + ' KB'
    : (bytes / 1048576).toFixed(2) + ' MB';
}

function updateCountBadge(total, filtered = null) {
  const badge = document.getElementById('expenses-count-badge');
  if (!badge) return;
  badge.textContent = filtered !== null
    ? `${filtered} de ${total} gasto${total !== 1 ? 's' : ''}`
    : `${total} gasto${total !== 1 ? 's' : ''}`;
}

function showTableLoading(loading) {
  document.getElementById('exp-table-loading').style.display  = loading ? 'flex' : 'none';
  document.getElementById('exp-table-wrapper').style.display  = loading ? 'none' : '';
  document.getElementById('exp-table-empty').style.display    = 'none';
}

function showFeedback(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '\u2714', error: '\u2715', warning: '\u26a0', info: '\u2139' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${icons[type] || '\u2139'}</span>
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
    ? '<span class="spinner spinner--sm"></span> Guardando\u2026'
    : btn.dataset.originalText;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

// --- Scoped Styles -----------------------------------------------------------

function injectStyles() {
  if (document.getElementById('expenses-module-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'expenses-module-styles';
  tag.textContent = `
    .exp-filters {
      display: flex; flex-wrap: wrap; gap: var(--space-sm) var(--space-md);
      align-items: flex-end;
      padding: 0 var(--space-lg) var(--space-lg);
    }

    .exp-attach-section {
      border-top: 1px solid var(--color-border);
      margin-top: var(--space-lg); padding-top: var(--space-lg);
    }
    .exp-attach-header {
      display: flex; align-items: center; gap: var(--space-md);
      margin-bottom: var(--space-sm);
    }
    .exp-attach-list {
      display: flex; flex-direction: column;
      gap: var(--space-xs); margin-top: var(--space-sm);
    }
    .exp-attach-chip {
      display: flex; align-items: center; gap: var(--space-sm);
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); background: var(--color-bg-surface);
    }
    .exp-attach-icon { font-size: 1rem; flex-shrink: 0; }
    .exp-attach-name {
      flex: 1; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; font-size: 0.85rem;
    }
    .exp-attach-size { font-size: 0.75rem; color: var(--color-text-muted); flex-shrink: 0; }

    .exp-investor-section {
      border-top: 1px solid var(--color-border);
      margin-top: var(--space-lg); padding-top: var(--space-lg);
    }
    .exp-investor-toggle {
      display: flex; align-items: flex-start; gap: var(--space-sm);
      cursor: pointer;
    }
    .exp-investor-toggle input[type="checkbox"] {
      margin-top: 2px; flex-shrink: 0; accent-color: var(--color-warning, #f59e0b);
    }
    .exp-investor-toggle-label {
      display: flex; flex-direction: column; gap: 2px;
    }
    .exp-investor-fields {
      margin-top: var(--space-md);
      padding: var(--space-md);
      background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 30%, transparent);
      border-radius: var(--radius-md);
    }
  `;
  document.head.appendChild(tag);
}
