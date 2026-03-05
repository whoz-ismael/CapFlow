/**
 * investor.js — CapFlow Investor Module
 *
 * Tracks a single investor relationship structured as a loan:
 *   - Current outstanding debt (totalDebt)
 *   - Investment transactions (increase debt)
 *   - Amortization transactions (decrease debt)
 *   - Full transaction history
 *
 * The investor is linked to a Customer record via clientId — no name is
 * hardcoded here. The Customer record is loaded alongside the investor
 * record so the UI can display the investor's name.
 *
 * FUTURE INTEGRATION HOOK:
 *   The Sales module will call:
 *     InvestorAPI.addAmortization(amount, saleId)
 *   to auto-reduce debt when manufactured-product sales are recorded.
 *   No changes to this file are needed for that integration.
 *
 * Data source: api.js → InvestorAPI + CustomersAPI (localStorage prototype).
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

import { InvestorAPI, CustomersAPI } from '../api.js';

// ─── Module State ─────────────────────────────────────────────────────────────

let investorRecord = null;
let allCustomers   = [];

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function mountInvestor(container) {
  container.innerHTML = buildShellHTML();
  injectStyles();
  attachListeners();
  await loadData();
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────

function buildShellHTML() {
  return `
    <section class="module" id="investor-module">

      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">◇</span>
          <div>
            <h1 class="module-header__title">Inversionista</h1>
            <p class="module-header__subtitle">Seguimiento de deuda e historial de transacciones</p>
          </div>
        </div>
      </header>

      <!-- Loading -->
      <div id="inv-loading" style="display:flex;align-items:center;gap:12px;padding:var(--space-xl);color:var(--color-text-muted);">
        <div class="spinner"></div>
        <span>Cargando…</span>
      </div>

      <!-- First-time setup (shown when no investor record exists) -->
      <div class="card" id="inv-setup-card" style="display:none;">
        <div class="card__header">
          <h2 class="card__title">
            <span class="card__title-icon">◇</span>
            Configurar Inversionista
          </h2>
        </div>
        <p style="color:var(--color-text-muted);margin-bottom:var(--space-lg);">
          Selecciona el cliente que actuará como inversionista para comenzar a registrar transacciones.
        </p>
        <form id="inv-setup-form" novalidate>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="inv-setup-client">
                Cliente / Inversionista <span class="required">*</span>
              </label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="inv-setup-client" required>
                  <option value="" disabled selected>Seleccionar cliente…</option>
                </select>
              </div>
              <span class="form-error" id="inv-setup-error"></span>
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary" id="inv-setup-submit-btn">
              <span class="btn__icon">◇</span>
              Inicializar Módulo
            </button>
          </div>
        </form>
      </div>

      <!-- Main content (shown once investor exists) -->
      <div id="inv-content" style="display:none;">

        <!-- Summary card -->
        <div class="card">
          <div class="card__header">
            <h2 class="card__title">
              <span class="card__title-icon">◇</span>
              Resumen de Deuda
            </h2>
            <button class="btn btn--ghost btn--sm" id="inv-change-client-btn">
              ✎ Cambiar inversionista
            </button>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Inversionista</label>
              <p class="inv-summary-value" id="inv-client-name">—</p>
            </div>
            <div class="form-group">
              <label class="form-label">Deuda actual</label>
              <p class="inv-summary-value inv-summary-value--debt" id="inv-total-debt">RD$ 0.00</p>
            </div>
            <div class="form-group">
              <label class="form-label">Total invertido</label>
              <p class="inv-summary-value" id="inv-total-invested">RD$ 0.00</p>
            </div>
            <div class="form-group">
              <label class="form-label">Total amortizado</label>
              <p class="inv-summary-value inv-summary-value--positive" id="inv-total-amortized">RD$ 0.00</p>
            </div>
          </div>
        </div>

        <!-- Transaction forms -->
        <div class="inv-forms-row">

          <div class="card">
            <div class="card__header">
              <h2 class="card__title">
                <span class="card__title-icon">↑</span>
                Nueva Inversión
              </h2>
            </div>
            <form id="inv-investment-form" novalidate>
              <div class="form-grid">
                <div class="form-group form-group--wide">
                  <label class="form-label" for="inv-invest-amount">
                    Monto (RD$) <span class="required">*</span>
                  </label>
                  <input class="form-input" type="number" id="inv-invest-amount"
                    min="0.01" step="0.01" placeholder="0.00">
                  <span class="form-error" id="inv-invest-error"></span>
                </div>
                <div class="form-group form-group--wide">
                  <label class="form-label" for="inv-invest-note">Nota (opcional)</label>
                  <input class="form-input" type="text" id="inv-invest-note"
                    placeholder="Ej: Transferencia enero 2026" maxlength="120">
                </div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn--primary" id="inv-invest-submit-btn">
                  <span class="btn__icon">↑</span> Registrar Inversión
                </button>
              </div>
            </form>
          </div>

          <div class="card">
            <div class="card__header">
              <h2 class="card__title">
                <span class="card__title-icon">↓</span>
                Amortización Manual
              </h2>
            </div>
            <form id="inv-amortization-form" novalidate>
              <div class="form-grid">
                <div class="form-group form-group--wide">
                  <label class="form-label" for="inv-amort-amount">
                    Monto (RD$) <span class="required">*</span>
                  </label>
                  <input class="form-input" type="number" id="inv-amort-amount"
                    min="0.01" step="0.01" placeholder="0.00">
                  <span class="form-error" id="inv-amort-error"></span>
                </div>
                <div class="form-group form-group--wide">
                  <label class="form-label" for="inv-amort-note">Nota (opcional)</label>
                  <input class="form-input" type="text" id="inv-amort-note"
                    placeholder="Ej: Pago parcial feb 2026" maxlength="120">
                </div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn--warning" id="inv-amort-submit-btn">
                  <span class="btn__icon">↓</span> Registrar Amortización
                </button>
              </div>
            </form>
          </div>

        </div><!-- /inv-forms-row -->

        <!-- History table -->
        <div class="card">
          <div class="card__header">
            <h2 class="card__title">
              <span class="card__title-icon">☰</span>
              Historial de Transacciones
            </h2>
            <div class="module-header__badge" id="inv-history-badge">— registros</div>
          </div>

          <div class="table-empty" id="inv-history-empty" style="display:none;">
            <span class="table-empty__icon">◇</span>
            <p>No hay transacciones registradas aún.</p>
            <p class="table-empty__sub">Registra la primera inversión usando el formulario de arriba.</p>
          </div>

          <div class="table-wrapper" id="inv-history-wrapper" style="display:none;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th class="text-right">Monto</th>
                  <th>Referencia</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody id="inv-history-tbody"></tbody>
            </table>
          </div>
        </div>

      </div><!-- /inv-content -->

      <!-- Change-client modal -->
      <div class="inv-modal-backdrop inv-modal-backdrop--hidden" id="inv-modal-backdrop">
        <div class="inv-modal" role="dialog" aria-modal="true" aria-labelledby="inv-modal-title">
          <div class="inv-modal__header">
            <h3 class="inv-modal__title" id="inv-modal-title">Cambiar Inversionista</h3>
            <button class="inv-modal__close" id="inv-modal-close" aria-label="Cerrar">✕</button>
          </div>
          <div class="inv-modal__body">
            <p style="color:var(--color-text-muted);margin-bottom:var(--space-md);">
              El historial y la deuda actual se conservan. Solo cambia la referencia al cliente.
            </p>
            <div class="form-group">
              <label class="form-label" for="inv-modal-client">Cliente</label>
              <div class="select-wrapper">
                <select class="form-input form-select" id="inv-modal-client">
                  <option value="" disabled>Seleccionar…</option>
                </select>
              </div>
            </div>
          </div>
          <div class="inv-modal__footer">
            <button class="btn btn--ghost" id="inv-modal-cancel-btn">Cancelar</button>
            <button class="btn btn--primary" id="inv-modal-save-btn">Guardar Cambio</button>
          </div>
        </div>
      </div>

    </section>
  `;
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
  try {
    [investorRecord, allCustomers] = await Promise.all([
      InvestorAPI.get(),
      CustomersAPI.getAll(),
    ]);
    render();
  } catch (err) {
    showFeedback(`Error al cargar datos: ${err.message}`, 'error');
  } finally {
    document.getElementById('inv-loading').style.display = 'none';
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const content   = document.getElementById('inv-content');
  const setupCard = document.getElementById('inv-setup-card');

  if (!investorRecord) {
    content.style.display   = 'none';
    setupCard.style.display = 'block';
    populateClientDropdown('inv-setup-client', '');
    return;
  }

  content.style.display   = 'block';
  setupCard.style.display = 'none';
  fillSummary();
  fillHistory();
}

function fillSummary() {
  const client = allCustomers.find(c => String(c.id) === String(investorRecord.clientId));

  document.getElementById('inv-client-name').textContent =
    client ? client.name : `ID: ${investorRecord.clientId}`;

  document.getElementById('inv-total-debt').textContent =
    formatCurrency(investorRecord.totalDebt);

  const history        = investorRecord.history || [];
  const totalInvested  = history.filter(e => e.type === 'investment').reduce((s, e) => s + e.amount, 0);
  const totalAmortized = history.reduce((s, e) => {
    if (e.type === 'amortization') return s + e.amount;
    if (e.type === 'reversal')     return s - e.amount;
    return s;
  }, 0);

  document.getElementById('inv-total-invested').textContent  = formatCurrency(totalInvested);
  document.getElementById('inv-total-amortized').textContent = formatCurrency(totalAmortized);
}

function fillHistory() {
  const history = [...(investorRecord.history || [])].reverse();
  const badge   = document.getElementById('inv-history-badge');
  const empty   = document.getElementById('inv-history-empty');
  const wrapper = document.getElementById('inv-history-wrapper');
  const tbody   = document.getElementById('inv-history-tbody');

  badge.textContent = `${history.length} registro${history.length !== 1 ? 's' : ''}`;

  if (history.length === 0) {
    empty.style.display   = 'flex';
    wrapper.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  wrapper.style.display = 'block';
  tbody.innerHTML = history.map(buildHistoryRow).join('');
}

function buildHistoryRow(entry) {
  const isInvestment = entry.type === 'investment';
  const typeLabel    = isInvestment ? 'Inversión'    : 'Amortización';
  const typeClass    = isInvestment ? 'badge--blue'  : 'badge--green';
  const amtClass     = isInvestment ? 'inv-amt-inv'  : 'inv-amt-amort';
  const sign         = isInvestment ? '+'            : '−';
  const refCell      = entry.referenceId
    ? `<code style="font-size:0.75rem;">${escapeHTML(String(entry.referenceId))}</code>`
    : '—';

  return `
    <tr class="table-row">
      <td>${formatDate(entry.date)}</td>
      <td><span class="badge ${typeClass}">${typeLabel}</span></td>
      <td class="text-right">
        <span class="${amtClass}">${sign} ${formatCurrency(entry.amount)}</span>
      </td>
      <td>${refCell}</td>
      <td>${escapeHTML(entry.note || '—')}</td>
    </tr>
  `;
}

// ─── Listeners ────────────────────────────────────────────────────────────────

function attachListeners() {
  document.getElementById('inv-setup-form').addEventListener('submit', handleSetupSubmit);
  document.getElementById('inv-investment-form').addEventListener('submit', handleInvestmentSubmit);
  document.getElementById('inv-amortization-form').addEventListener('submit', handleAmortizationSubmit);
  document.getElementById('inv-change-client-btn').addEventListener('click', openModal);
  document.getElementById('inv-modal-close').addEventListener('click', closeModal);
  document.getElementById('inv-modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('inv-modal-save-btn').addEventListener('click', handleChangeClientSave);
  document.getElementById('inv-modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'inv-modal-backdrop') closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleSetupSubmit(e) {
  e.preventDefault();
  const clientId = document.getElementById('inv-setup-client').value;
  const errEl    = document.getElementById('inv-setup-error');
  errEl.textContent = '';

  if (!clientId) {
    errEl.textContent = 'Selecciona un cliente para continuar.';
    return;
  }

  const btn = document.getElementById('inv-setup-submit-btn');
  setButtonLoading(btn, true);
  try {
    investorRecord = await InvestorAPI.create({ clientId });
    showFeedback('Módulo de inversionista inicializado.', 'success');
    render();
  } catch (err) {
    showFeedback(`Error: ${err.message}`, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleInvestmentSubmit(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('inv-invest-amount').value);
  const note   = document.getElementById('inv-invest-note').value.trim();
  const errEl  = document.getElementById('inv-invest-error');
  errEl.textContent = '';

  if (!amount || amount <= 0) {
    errEl.textContent = 'El monto debe ser mayor que cero.';
    return;
  }

  const btn = document.getElementById('inv-invest-submit-btn');
  setButtonLoading(btn, true);
  try {
    investorRecord = await InvestorAPI.addInvestment(amount, note);
    document.getElementById('inv-investment-form').reset();
    showFeedback(`Inversión de ${formatCurrency(amount)} registrada.`, 'success');
    fillSummary();
    fillHistory();
  } catch (err) {
    showFeedback(`Error: ${err.message}`, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleAmortizationSubmit(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('inv-amort-amount').value);
  const note   = document.getElementById('inv-amort-note').value.trim();
  const errEl  = document.getElementById('inv-amort-error');
  errEl.textContent = '';

  if (!amount || amount <= 0) {
    errEl.textContent = 'El monto debe ser mayor que cero.';
    return;
  }
  if (investorRecord && amount > investorRecord.totalDebt) {
    errEl.textContent = `El monto supera la deuda actual (${formatCurrency(investorRecord.totalDebt)}).`;
    return;
  }

  const btn = document.getElementById('inv-amort-submit-btn');
  setButtonLoading(btn, true);
  try {
    // null referenceId = manual entry. Sales will pass saleId here in the future.
    investorRecord = await InvestorAPI.addAmortization(amount, null, note);
    document.getElementById('inv-amortization-form').reset();
    showFeedback(`Amortización de ${formatCurrency(amount)} registrada.`, 'success');
    fillSummary();
    fillHistory();
  } catch (err) {
    showFeedback(`Error: ${err.message}`, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function openModal() {
  populateClientDropdown('inv-modal-client', investorRecord?.clientId || '');
  document.getElementById('inv-modal-backdrop').classList.remove('inv-modal-backdrop--hidden');
}

function closeModal() {
  document.getElementById('inv-modal-backdrop').classList.add('inv-modal-backdrop--hidden');
}

async function handleChangeClientSave() {
  const clientId = document.getElementById('inv-modal-client').value;
  if (!clientId) return;
  try {
    investorRecord = await InvestorAPI.updateClient(clientId);
    closeModal();
    showFeedback('Inversionista actualizado.', 'success');
    fillSummary();
  } catch (err) {
    showFeedback(`Error: ${err.message}`, 'error');
  }
}

// ─── Dropdown Helper ──────────────────────────────────────────────────────────

function populateClientDropdown(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const active  = allCustomers.filter(c => c.status !== 'inactive');
  const options = active.map(c => {
    const sel = String(c.id) === String(selectedId) ? 'selected' : '';
    return `<option value="${escapeHTML(c.id)}" ${sel}>${escapeHTML(c.name)}</option>`;
  });

  select.innerHTML =
    `<option value="" disabled ${!selectedId ? 'selected' : ''}>Seleccionar cliente…</option>` +
    options.join('');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-DO', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatCurrency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-DO', {
    style: 'currency', currency: 'DOP', minimumFractionDigits: 2,
  }).format(value);
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
  if (document.getElementById('inv-module-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'inv-module-styles';
  tag.textContent = `
    .inv-forms-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-lg);
    }
    @media (max-width: 700px) { .inv-forms-row { grid-template-columns: 1fr; } }

    .inv-summary-value {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--color-text);
      margin: 0;
      padding: var(--space-sm) 0;
    }
    .inv-summary-value--debt     { font-size: 1.6rem; color: var(--color-danger); }
    .inv-summary-value--positive { color: var(--color-success); }

    .text-right { text-align: right; }

    .inv-amt-inv   { color: var(--color-danger);  font-weight: 600; }
    .inv-amt-amort { color: var(--color-success); font-weight: 600; }

    .inv-modal-backdrop--hidden { display: none !important; }
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
      width: 100%; max-width: 460px;
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
  `;
  document.head.appendChild(tag);
}