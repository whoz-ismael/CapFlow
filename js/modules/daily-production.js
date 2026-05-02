/**
 * daily-production.js — Paquetes Diarios (CapFlow)
 *
 * Muestra los registros de paquetes enviados por los operarios de CapDispatch.
 * El admin puede editar y confirmar cada entrada (pending_review → confirmed).
 * La confirmación crea un registro de producción que actualiza el inventario.
 */

import {
  DailyProductionLogsAPI,
  DispatchOperatorsAPI,
  ProductionAPI,
  MachinesAPI,
  ProductsAPI,
  OperatorsAPI,
  InventoryAPI,
  ensureProductInventoryItem,
} from '../api.js';

// ─── Module state ─────────────────────────────────────────────────────────────

let allEntries          = [];
let allOperators        = [];
let allMachines         = [];
let allProducts         = [];
let allCapFlowOperators = [];
let filters             = { status: '', operatorId: '', dateFrom: '', dateTo: '' };
let _container          = null;

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function mountDailyProduction(container) {
  _container = container;
  container.innerHTML = buildModuleHTML();
  attachEventListeners();
  await loadData();
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildModuleHTML() {
  return `
    <section class="module" id="daily-production-module">

      <!-- Header -->
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">✦</span>
          <div>
            <h1 class="module-header__title">Paquetes Diarios</h1>
            <p class="module-header__subtitle">Registros enviados por los operarios — confirma para validar</p>
          </div>
        </div>
        <button class="btn btn--primary btn--sm" id="dp-refresh">↻ Actualizar</button>
      </header>

      <!-- Feedback -->
      <div id="dp-feedback" style="display:none;" class="dp-feedback"></div>

      <!-- Summary cards -->
      <div id="dp-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-md);"></div>

      <!-- Filters card -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title"><span class="card__title-icon">▤</span> Filtros</h2>
          <button class="btn btn--ghost btn--xs" id="dp-clear-filters">Limpiar</button>
        </div>
        <div style="padding:var(--space-md);display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-md);">
          <div class="form-group">
            <label class="form-label">Estado</label>
            <div class="select-wrapper">
              <select id="dp-filter-status" class="form-input form-select">
                <option value="">Todos</option>
                <option value="pending_review">Pendientes</option>
                <option value="confirmed">Confirmados</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Operario</label>
            <div class="select-wrapper">
              <select id="dp-filter-operator" class="form-input form-select">
                <option value="">Todos los operarios</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Desde</label>
            <input id="dp-filter-from" type="date" class="form-input"/>
          </div>
          <div class="form-group">
            <label class="form-label">Hasta</label>
            <input id="dp-filter-to" type="date" class="form-input"/>
          </div>
        </div>
        <div style="padding:0 var(--space-md) var(--space-md);display:flex;gap:var(--space-sm);">
          <button class="btn btn--primary btn--sm" id="dp-apply-filters">Aplicar filtros</button>
        </div>
      </div>

      <!-- Table card -->
      <div class="card">
        <div class="card__header">
          <h2 class="card__title"><span class="card__title-icon">◈</span> Registros de Paquetes</h2>
          <span class="module-header__badge" id="dp-count-bar">— registros</span>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Operario</th>
                <th>Producto</th>
                <th>Turno</th>
                <th class="text-right">Cantidad</th>
                <th>Notas</th>
                <th class="text-center">Estado</th>
                <th class="text-center">Acción</th>
              </tr>
            </thead>
            <tbody id="dp-tbody">
              <tr><td colspan="8" class="table-empty"><span>Cargando...</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </section>
  `;
}

// ─── Event listeners ──────────────────────────────────────────────────────────

function attachEventListeners() {
  _container.querySelector('#dp-refresh').addEventListener('click', loadData);
  _container.querySelector('#dp-apply-filters').addEventListener('click', applyFilters);
  _container.querySelector('#dp-clear-filters').addEventListener('click', clearFilters);
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadData() {
  try {
    hideFeedback();
    [allEntries, allOperators, allMachines, allProducts, allCapFlowOperators] = await Promise.all([
      DailyProductionLogsAPI.getAll(filters),
      DispatchOperatorsAPI.getAll().catch(() => []),
      MachinesAPI.getAll().catch(() => []),
      ProductsAPI.getAll().catch(() => []),
      OperatorsAPI.getAll().catch(() => []),
    ]);
    populateOperatorDropdown();
    renderTable(allEntries);
    renderSummary(allEntries);
    updateCountBar(allEntries.length);
  } catch (err) {
    showFeedback('Error al cargar los registros: ' + err.message, 'error');
    renderTable([]);
  }
}

function populateOperatorDropdown() {
  const sel = _container.querySelector('#dp-filter-operator');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos los operarios</option>';
  allOperators.forEach(op => {
    const opt = document.createElement('option');
    opt.value = op.id;
    opt.textContent = op.name;
    if (op.id === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ─── Filters ──────────────────────────────────────────────────────────────────

async function applyFilters() {
  filters.status     = _container.querySelector('#dp-filter-status').value;
  filters.operatorId = _container.querySelector('#dp-filter-operator').value;
  filters.dateFrom   = _container.querySelector('#dp-filter-from').value;
  filters.dateTo     = _container.querySelector('#dp-filter-to').value;
  await loadData();
}

function clearFilters() {
  filters = { status: '', operatorId: '', dateFrom: '', dateTo: '' };
  _container.querySelector('#dp-filter-status').value   = '';
  _container.querySelector('#dp-filter-operator').value = '';
  _container.querySelector('#dp-filter-from').value     = '';
  _container.querySelector('#dp-filter-to').value       = '';
  loadData();
}

// ─── Table ────────────────────────────────────────────────────────────────────

function renderTable(entries) {
  const tbody = _container.querySelector('#dp-tbody');
  if (!entries || entries.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="table-empty">
          <span class="table-empty__icon">✦</span>
          <span>Sin registros</span>
          <span class="table-empty__sub">Ajusta los filtros o espera nuevos envíos de los operarios</span>
        </div>
      </td></tr>`;
    return;
  }
  tbody.innerHTML = entries.map(buildTableRow).join('');
  tbody.querySelectorAll('.dp-confirm-btn').forEach(btn => {
    btn.addEventListener('click', () => handleConfirm(btn.dataset.id));
  });
  tbody.querySelectorAll('.dp-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => handleEdit(btn.dataset.id));
  });
  tbody.querySelectorAll('.dp-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
}

function buildTableRow(entry) {
  const date    = new Date(entry.production_date + 'T12:00:00');
  const dateStr = date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
  const shift   = entry.shift || '—';

  const statusBadge = entry.status === 'confirmed'
    ? `<span class="badge badge--green">✓ Confirmado</span>`
    : `<span class="badge badge--warning">⏳ Pendiente</span>`;

  const actionBtn = entry.status === 'pending_review'
    ? `<button class="btn btn--ghost btn--xs dp-edit-btn" data-id="${entry.id}">Editar</button>
       <button class="btn btn--primary btn--xs dp-confirm-btn" data-id="${entry.id}">Confirmar</button>
       <button class="btn btn--ghost btn--xs dp-delete-btn" data-id="${entry.id}" style="color:var(--color-danger);border-color:var(--color-danger);opacity:.7;" title="Eliminar registro">✕</button>`
    : `<span style="color:var(--color-text-muted);font-size:.8rem;">—</span>`;

  return `
    <tr class="table-row" data-entry-id="${entry.id}">
      <td style="white-space:nowrap;font-family:var(--font-mono);font-size:.82rem;color:var(--color-text-secondary);">${dateStr}</td>
      <td style="font-weight:500;">${entry.operator_name}</td>
      <td>${entry.color}</td>
      <td style="font-size:.82rem;color:var(--color-text-secondary);">${shift}</td>
      <td class="text-right" style="font-family:var(--font-mono);font-weight:600;">${entry.quantity.toLocaleString('es-DO')}</td>
      <td style="color:var(--color-text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.notes || '—'}</td>
      <td class="text-center">${statusBadge}</td>
      <td class="text-center td-actions" style="display:flex;align-items:center;justify-content:center;gap:.375rem;">${actionBtn}</td>
    </tr>`;
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

function handleEdit(id) {
  const entry = allEntries.find(e => e.id === id);
  if (!entry) return;

  const machineOptions = allMachines
    .filter(m => m.isActive !== false)
    .map(m => `<option value="${m.id}" ${entry.machine_id === m.id ? 'selected' : ''}>${m.name || m.code || m.id}</option>`)
    .join('');

  const productOptions = allProducts
    .filter(p => p.active !== false)
    .map(p => `<option value="${p.id}" ${entry.product_id === p.id ? 'selected' : ''}>${p.name}</option>`)
    .join('');

  const shiftOpts = ['Matutino', 'Vespertino', 'Nocturno']
    .map(s => `<option value="${s}" ${entry.shift === s ? 'selected' : ''}>${s}</option>`)
    .join('');

  const modal = document.createElement('div');
  modal.id = 'dp-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1000;';
  modal.innerHTML = `
    <div style="background:var(--color-bg-card);border-radius:var(--radius-lg);padding:var(--space-xl);width:min(480px,95vw);box-shadow:0 8px 32px rgba(0,0,0,.6);">
      <h2 style="margin:0 0 var(--space-lg);font-family:var(--font-display);font-size:1.1rem;">Editar registro</h2>
      <div class="form-group">
        <label class="form-label">Fecha</label>
        <input id="dp-edit-date" type="date" class="form-input" value="${entry.production_date}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Producto</label>
        <div class="select-wrapper">
          <select id="dp-edit-product" class="form-input form-select">
            <option value="">— Sin producto —</option>
            ${productOptions}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Turno</label>
        <div class="select-wrapper">
          <select id="dp-edit-shift" class="form-input form-select">
            <option value="">— Sin turno —</option>
            ${shiftOpts}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Máquina</label>
        <div class="select-wrapper">
          <select id="dp-edit-machine" class="form-input form-select">
            <option value="">— Sin máquina —</option>
            ${machineOptions}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Cantidad</label>
        <input id="dp-edit-qty" type="number" class="form-input" min="1" value="${entry.quantity}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Notas</label>
        <textarea id="dp-edit-notes" class="form-input" rows="2" style="resize:vertical;">${entry.notes || ''}</textarea>
      </div>
      <div id="dp-edit-err" style="display:none;color:var(--color-danger);font-size:.875rem;margin-bottom:var(--space-sm);"></div>
      <div style="display:flex;gap:var(--space-sm);justify-content:flex-end;margin-top:var(--space-lg);">
        <button id="dp-edit-cancel" class="btn btn--ghost btn--sm">Cancelar</button>
        <button id="dp-edit-save"   class="btn btn--primary btn--sm">Guardar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#dp-edit-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#dp-edit-save').addEventListener('click', async () => {
    const saveBtn = modal.querySelector('#dp-edit-save');
    const errEl   = modal.querySelector('#dp-edit-err');
    const qty     = Number(modal.querySelector('#dp-edit-qty').value);

    if (!qty || qty < 1) {
      errEl.textContent = 'La cantidad debe ser mayor a 0.';
      errEl.style.display = 'block';
      return;
    }

    saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
    try {
      const productId = modal.querySelector('#dp-edit-product').value || null;
      const product   = productId ? allProducts.find(p => p.id === productId) : null;
      const fields = {
        production_date: modal.querySelector('#dp-edit-date').value,
        product_id:      productId,
        color:           product ? product.name : entry.color,
        shift:           modal.querySelector('#dp-edit-shift').value   || null,
        machine_id:      modal.querySelector('#dp-edit-machine').value || null,
        quantity:        qty,
        notes:           modal.querySelector('#dp-edit-notes').value.trim(),
      };
      await DailyProductionLogsAPI.update(id, fields);
      modal.remove();
      await loadData();
      showFeedback('Registro actualizado correctamente.', 'success');
    } catch (err) {
      errEl.textContent = 'Error al guardar: ' + err.message;
      errEl.style.display = 'block';
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
    }
  });
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

async function handleConfirm(id) {
  const entry = allEntries.find(e => e.id === id);
  if (!entry) return;

  // Resolve capflow_operator_id from the already-loaded dispatch operators list
  const dispatchOp      = allOperators.find(op => op.id === entry.operator_id);
  const capflowOperatorId   = dispatchOp?.capflow_operator_id ?? null;
  const needsOperatorSelect = capflowOperatorId === null;
  const needsProduct        = !entry.product_id;
  const needsMachine        = !entry.machine_id;

  const productOptions = allProducts
    .map(p => `<option value="${p.id}">${p.name}</option>`)
    .join('');
  const machineOptions = allMachines
    .map(m => `<option value="${m.id}">${m.name || m.code || m.id}</option>`)
    .join('');
  const operatorOptions = allCapFlowOperators
    .filter(op => op.isActive !== false)
    .map(op => `<option value="${op.id}">${op.name}</option>`)
    .join('');

  // Resolve names so the modal can show what the operator already entered
  // in CapDispatch (product_id, machine_id, shift) instead of just the
  // free-text color label.
  const productName = entry.product_id
    ? (allProducts.find(p => p.id === entry.product_id)?.name || entry.color || '—')
    : (entry.color || '—');
  const machineRecord = entry.machine_id
    ? allMachines.find(m => m.id === entry.machine_id)
    : null;
  const machineName = machineRecord
    ? (machineRecord.name || machineRecord.code || machineRecord.id)
    : '—';
  const shiftLabel = entry.shift || '—';

  const modal = document.createElement('div');
  modal.id = 'dp-confirm-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1000;';
  modal.innerHTML = `
    <div style="background:var(--color-bg-card);border-radius:var(--radius-lg);padding:var(--space-xl);width:min(440px,95vw);box-shadow:0 8px 32px rgba(0,0,0,.6);">
      <h2 style="margin:0 0 var(--space-md);font-family:var(--font-display);font-size:1.1rem;">Confirmar registro</h2>
      <div style="font-size:.85rem;color:var(--color-text-secondary);margin:0 0 var(--space-lg);display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem;">
        <span style="color:var(--color-text-muted);">Operario:</span><span><strong>${entry.operator_name}</strong></span>
        <span style="color:var(--color-text-muted);">Producto:</span><span>${productName}</span>
        <span style="color:var(--color-text-muted);">Máquina:</span><span>${machineName}</span>
        <span style="color:var(--color-text-muted);">Turno:</span><span>${shiftLabel}</span>
        <span style="color:var(--color-text-muted);">Cantidad:</span><span>${entry.quantity.toLocaleString('es-DO')} paquetes</span>
        <span style="color:var(--color-text-muted);">Fecha:</span><span>${entry.production_date}</span>
      </div>
      ${needsProduct ? `
        <div class="form-group">
          <label class="form-label">Producto <span style="color:var(--color-danger);">*</span></label>
          <div class="select-wrapper">
            <select id="dp-confirm-product" class="form-input form-select">
              <option value="">— Selecciona un producto —</option>
              ${productOptions}
            </select>
          </div>
        </div>` : ''}
      ${needsMachine ? `
        <div class="form-group">
          <label class="form-label">Máquina <span style="color:var(--color-danger);">*</span></label>
          <div class="select-wrapper">
            <select id="dp-confirm-machine" class="form-input form-select">
              <option value="">— Selecciona una máquina —</option>
              ${machineOptions}
            </select>
          </div>
        </div>` : ''}
      <div class="form-group">
        <label class="form-label">Tarifa del operador (RD$/paquete) <span style="color:var(--color-danger);">*</span></label>
        <input id="dp-confirm-rate" type="number" class="form-input" min="0.01" step="0.01" placeholder="Ej: 0.50"/>
      </div>
      ${needsOperatorSelect ? `
        <div class="form-group">
          <label class="form-label">Operario CapFlow <span style="color:var(--color-danger);">*</span></label>
          <div class="select-wrapper">
            <select id="dp-confirm-operator" class="form-input form-select">
              <option value="">— Selecciona un operario —</option>
              ${operatorOptions}
            </select>
          </div>
          <p style="font-size:.75rem;color:var(--color-text-muted);margin:.25rem 0 0;">El operario de despacho no está vinculado a un operario de CapFlow.</p>
        </div>` : ''}
      <div id="dp-confirm-err" style="display:none;color:var(--color-danger);font-size:.875rem;margin-bottom:var(--space-sm);"></div>
      <div style="display:flex;gap:var(--space-sm);justify-content:flex-end;margin-top:var(--space-lg);">
        <button id="dp-confirm-cancel" class="btn btn--ghost btn--sm">Cancelar</button>
        <button id="dp-confirm-ok"     class="btn btn--primary btn--sm">Confirmar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#dp-confirm-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#dp-confirm-ok').addEventListener('click', async () => {
    const okBtn = modal.querySelector('#dp-confirm-ok');
    const errEl = modal.querySelector('#dp-confirm-err');

    // Rate
    const operatorRateSnapshot = Number(modal.querySelector('#dp-confirm-rate')?.value);
    if (!operatorRateSnapshot || operatorRateSnapshot <= 0) {
      errEl.textContent = 'Ingresa una tarifa válida mayor a 0.';
      errEl.style.display = 'block';
      return;
    }

    // Product
    let resolvedProductId = entry.product_id;
    if (needsProduct) {
      resolvedProductId = modal.querySelector('#dp-confirm-product')?.value || null;
      if (!resolvedProductId) {
        errEl.textContent = 'Selecciona un producto.';
        errEl.style.display = 'block';
        return;
      }
    }

    // Machine
    let resolvedMachineId = entry.machine_id;
    if (needsMachine) {
      resolvedMachineId = modal.querySelector('#dp-confirm-machine')?.value || null;
      if (!resolvedMachineId) {
        errEl.textContent = 'Selecciona una máquina.';
        errEl.style.display = 'block';
        return;
      }
    }

    // CapFlow operator
    let resolvedOperatorId = capflowOperatorId;
    if (needsOperatorSelect) {
      resolvedOperatorId = modal.querySelector('#dp-confirm-operator')?.value || null;
      if (!resolvedOperatorId) {
        errEl.textContent = 'Selecciona un operario de CapFlow.';
        errEl.style.display = 'block';
        return;
      }
    }

    okBtn.disabled = true; okBtn.textContent = 'Confirmando...';

    try {
      // Save resolved product/machine onto the log record before confirming
      await DailyProductionLogsAPI.update(id, {
        product_id: resolvedProductId,
        machine_id: resolvedMachineId,
      });

      const confirmed = await DailyProductionLogsAPI.confirm(id);

      let createdProductionId = null;
      try {
        // Mirror Producción module: create the production row AND credit
        // finished-goods inventory. Without the inventory step, the
        // "Inventario" history loses entradas for confirmed Tapas Diarias.
        const product = allProducts.find(p => p.id === resolvedProductId);
        if (!product || product.type !== 'manufactured') {
          throw new Error('El producto seleccionado no es de tipo "Fabricado".');
        }

        const newProductionRecord = await ProductionAPI.create({
          productId:                resolvedProductId,
          machineId:                resolvedMachineId,
          operatorId:               resolvedOperatorId,
          shift:                    entry.shift,
          quantity:                 entry.quantity,
          productionDate:           entry.production_date,
          operatorRateSnapshot:     operatorRateSnapshot,
          weightPerPackageSnapshot: 0,
        });
        createdProductionId = newProductionRecord.id;

        const finishedItemId = await ensureProductInventoryItem(product);
        await InventoryAPI.addStock(
          finishedItemId,
          entry.quantity,
          newProductionRecord.id,
          'Salida de producción'
        );
      } catch (prodErr) {
        // Roll back: delete the orphan production row (if any) and revert
        // the log status so the supervisor can try again cleanly.
        if (createdProductionId) {
          try { await ProductionAPI.remove(createdProductionId); } catch {}
        }
        await DailyProductionLogsAPI.update(id, { status: 'pending_review', confirmed_at: null });
        throw new Error('Error al crear registro de producción: ' + prodErr.message);
      }

      const idx = allEntries.findIndex(e => e.id === id);
      if (idx !== -1) allEntries[idx] = confirmed;
      modal.remove();
      await loadData();
      showFeedback('Registro confirmado correctamente.', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      okBtn.disabled = false; okBtn.textContent = 'Confirmar';
    }
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function handleDelete(id) {
  const entry = allEntries.find(e => e.id === id);
  if (!entry) return;

  const date    = new Date(entry.production_date + 'T12:00:00');
  const dateStr = date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem;';
  overlay.innerHTML = `
    <div style="background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-xl);max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.6);">
      <h3 style="margin:0 0 var(--space-sm);font-size:1rem;font-weight:700;color:var(--color-danger);">Eliminar registro</h3>
      <p style="margin:0 0 var(--space-md);font-size:.875rem;color:var(--color-text-secondary);">¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer.</p>
      <div style="background:var(--color-bg-base);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-lg);font-size:.82rem;color:var(--color-text-secondary);display:grid;gap:.25rem;">
        <div><span style="color:var(--color-text-muted);">Fecha:</span> ${dateStr}</div>
        <div><span style="color:var(--color-text-muted);">Operario:</span> ${entry.operator_name}</div>
        <div><span style="color:var(--color-text-muted);">Color:</span> ${entry.color}</div>
        <div><span style="color:var(--color-text-muted);">Cantidad:</span> ${entry.quantity.toLocaleString('es-DO')}</div>
      </div>
      <div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">
        <button id="dp-delete-cancel" class="btn btn--ghost btn--sm">Cancelar</button>
        <button id="dp-delete-confirm" class="btn btn--sm" style="background:var(--color-danger);color:#fff;border-color:var(--color-danger);">Eliminar</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('#dp-delete-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#dp-delete-confirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#dp-delete-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '...';
    try {
      await DailyProductionLogsAPI.remove(id);
      allEntries = allEntries.filter(e => e.id !== id);
      overlay.remove();
      renderTable(allEntries);
      renderSummary(allEntries);
      updateCountBar(allEntries.length);
      showFeedback('Registro eliminado correctamente.', 'success');
    } catch (err) {
      overlay.remove();
      showFeedback('Error al eliminar: ' + err.message, 'error');
    }
  });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function renderSummary(entries) {
  const total     = entries.reduce((s, e) => s + e.quantity, 0);
  const confirmed = entries.filter(e => e.status === 'confirmed').reduce((s, e) => s + e.quantity, 0);
  const pending   = entries.filter(e => e.status === 'pending_review').reduce((s, e) => s + e.quantity, 0);

  const card = (label, value) => `
    <div class="card" style="padding:var(--space-md) var(--space-lg);">
      <p style="font-family:var(--font-display);font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted);margin:0 0 .375rem;">${label}</p>
      <p style="font-family:var(--font-mono);font-size:1.75rem;font-weight:700;color:var(--color-text-primary);margin:0;">${value.toLocaleString('es-DO')}</p>
    </div>`;

  _container.querySelector('#dp-summary').innerHTML =
    card('Total paquetes', total) +
    card('Confirmados',    confirmed) +
    card('Pendientes',     pending);
}

function updateCountBar(count) {
  const el = _container.querySelector('#dp-count-bar');
  if (el) el.textContent = `${count} registro${count !== 1 ? 's' : ''}`;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function showFeedback(message, type) {
  const el = _container.querySelector('#dp-feedback');
  if (!el) return;
  const styles = {
    success: 'background:var(--color-success-dim);border:1px solid rgba(46,204,113,.3);color:var(--color-success);',
    error:   'background:var(--color-danger-dim);border:1px solid rgba(231,76,60,.3);color:var(--color-danger);',
  }[type] || '';
  el.style.cssText = `display:block;padding:.75rem 1rem;border-radius:var(--radius-md);font-size:.875rem;font-weight:500;${styles}`;
  el.textContent = message;
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function hideFeedback() {
  const el = _container.querySelector('#dp-feedback');
  if (el) el.style.display = 'none';
}
