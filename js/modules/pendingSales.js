/**
 * pendingSales.js — Módulo "Ventas Pendientes"
 *
 * Muestra las ventas despachadas desde CapDispatch con status 'pending_review'.
 * El administrador puede Confirmar o Rechazar cada venta.
 *
 * Confirmar:
 *   1. Cambia status → 'confirmed'
 *   2. Descuenta inventario por cada línea manufacturada
 *   3. Registra el pago en sale_payments
 *   4. Si es venta de inversionista → actualiza amortización
 *   5. Registra en change_history
 *
 * Rechazar:
 *   1. Cambia status → 'rejected'
 *   2. Registra en change_history
 *   (la venta permanece en la tabla como registro de auditoría)
 */

import {
  SalesAPI,
  CustomersAPI,
  ProductsAPI,
  InventoryAPI,
  InvestorAPI,
  SalePaymentsAPI,
  ChangeHistoryAPI,
  ensureProductInventoryItem,
} from '../api.js';
import { AuthAPI } from '../auth.js';

// ─── ESTADO DEL MÓDULO ────────────────────────────────────────────────────────

let _pendingSales   = [];
let _customerMap    = new Map();   // id → customer
let _productMap     = new Map();   // id → product
let _investorRecord = null;        // registro del inversionista (puede ser null)
let _currentAdmin   = { id: null, name: 'Admin' };
let _container      = null;

// ─── PUNTO DE ENTRADA ─────────────────────────────────────────────────────────

export async function mountPendingSales(container) {
  _container = container;
  _container.innerHTML = _buildShellHTML();

  _attachTopListeners();
  await _loadAll();
}

// ─── CARGA DE DATOS ───────────────────────────────────────────────────────────

async function _loadAll() {
  _setLoading(true);
  try {
    const session = await AuthAPI.getSession();
    _currentAdmin = {
      id:   session?.user?.id   ?? null,
      name: session?.user?.email ?? 'Admin',
    };

    const [sales, customers, products, investor] = await Promise.all([
      SalesAPI.getPendingReview(),
      CustomersAPI.getAll(),
      ProductsAPI.getAll(),
      InvestorAPI.get().catch(() => null),
    ]);

    _pendingSales   = sales;
    _investorRecord = investor;

    _customerMap = new Map(customers.map(c => [c.id, c]));
    _productMap  = new Map(products.map(p => [p.id, p]));

    _renderList();
  } catch (err) {
    _showBanner(`Error cargando ventas pendientes: ${err.message}`, 'error');
  } finally {
    _setLoading(false);
  }
}

// ─── RENDERIZADO ──────────────────────────────────────────────────────────────

function _renderList() {
  const listEl = document.getElementById('ps-list');
  if (!listEl) return;

  const countEl = document.getElementById('ps-count');
  if (countEl) {
    countEl.textContent = _pendingSales.length === 0
      ? 'Sin ventas pendientes'
      : `${_pendingSales.length} venta${_pendingSales.length !== 1 ? 's' : ''} pendiente${_pendingSales.length !== 1 ? 's' : ''}`;
  }

  if (_pendingSales.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">✓</div>
        <p class="empty-state__text">No hay ventas pendientes de revisión.</p>
        <p class="empty-state__sub">Todas las ventas de CapDispatch han sido procesadas.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = _pendingSales.map(sale => _buildSaleCard(sale)).join('');
  _attachCardListeners();
}

function _buildSaleCard(sale) {
  const customer   = _customerMap.get(sale.clientId);
  const clientName = customer?.name ?? sale.clientId ?? '—';
  const opName     = sale.operatorName || '—';
  const dispatchAt = sale.createdAt ? _fmtDatetime(sale.createdAt) : '—';
  const revenue    = _fmt(sale.totals?.revenue ?? 0);
  const method     = _fmtMethod(sale.paymentMethod);
  const invoice    = sale.invoiceNumber || '—';
  const isInv      = sale.isInvestor;

  const linesHTML = (sale.lines || []).map(line => {
    const prod    = _productMap.get(line.productId);
    const name    = prod?.name ?? line.productId ?? 'Producto';
    const qty     = Number(line.quantity || 0);
    const price   = _fmt(Number(line.unitPrice || line.salePricePerUnit || 0));
    return `<div class="ps-card__line">
      <span class="ps-card__line-name">${_esc(name)}</span>
      <span class="ps-card__line-qty">${qty} paq.</span>
      <span class="ps-card__line-price">${price}/paq.</span>
    </div>`;
  }).join('');

  return `
    <div class="ps-card card" data-sale-id="${_esc(sale.id)}">
      <div class="ps-card__header">
        <div class="ps-card__meta">
          <span class="badge badge--warning">Pendiente</span>
          ${isInv ? '<span class="badge badge--info">Inversionista</span>' : ''}
          <span class="ps-card__invoice">${_esc(invoice)}</span>
        </div>
        <div class="ps-card__actions">
          <button class="btn btn--sm btn--success ps-confirm-btn"
            data-sale-id="${_esc(sale.id)}"
            title="Confirmar y procesar venta">
            ✓ Confirmar
          </button>
          <button class="btn btn--sm btn--danger ps-reject-btn"
            data-sale-id="${_esc(sale.id)}"
            title="Rechazar venta">
            ✕ Rechazar
          </button>
        </div>
      </div>

      <div class="ps-card__body">
        <div class="ps-card__info-grid">
          <div class="ps-card__info-item">
            <span class="ps-card__info-label">Operario</span>
            <span class="ps-card__info-value">${_esc(opName)}</span>
          </div>
          <div class="ps-card__info-item">
            <span class="ps-card__info-label">Despachado</span>
            <span class="ps-card__info-value">${_esc(dispatchAt)}</span>
          </div>
          <div class="ps-card__info-item">
            <span class="ps-card__info-label">Cliente</span>
            <span class="ps-card__info-value">${_esc(clientName)}</span>
          </div>
          <div class="ps-card__info-item">
            <span class="ps-card__info-label">Método de pago</span>
            <span class="ps-card__info-value">${_esc(method)}</span>
          </div>
        </div>

        <div class="ps-card__lines">
          <div class="ps-card__lines-header">Productos</div>
          ${linesHTML || '<span class="text-muted">—</span>'}
        </div>

        <div class="ps-card__total">
          Total: <strong>${revenue}</strong>
        </div>
      </div>
    </div>`;
}

// ─── LISTENERS ────────────────────────────────────────────────────────────────

function _attachTopListeners() {
  const refreshBtn = document.getElementById('ps-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', _loadAll);
}

function _attachCardListeners() {
  document.querySelectorAll('.ps-confirm-btn').forEach(btn => {
    btn.addEventListener('click', () => _handleConfirm(btn.dataset.saleId));
  });
  document.querySelectorAll('.ps-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => _handleReject(btn.dataset.saleId));
  });
}

// ─── CONFIRMAR VENTA ─────────────────────────────────────────────────────────

async function _handleConfirm(saleId) {
  const sale = _pendingSales.find(s => s.id === saleId);
  if (!sale) return;

  const btn = document.querySelector(`.ps-confirm-btn[data-sale-id="${saleId}"]`);
  const rejectBtn = document.querySelector(`.ps-reject-btn[data-sale-id="${saleId}"]`);
  _setBtnLoading(btn, true, 'Confirmando…');
  if (rejectBtn) rejectBtn.disabled = true;

  try {
    // 1. Cambiar status a confirmed
    await SalesAPI.update(saleId, { status: 'confirmed' });

    // 2. Descontar inventario por cada línea manufacturada
    const manufacturedLines = (sale.lines || []).filter(
      l => l.productType === 'manufactured'
    );
    for (const line of manufacturedLines) {
      const product = _productMap.get(line.productId);
      if (!product) continue;
      try {
        const itemId = await ensureProductInventoryItem(product);
        await InventoryAPI.removeStock(
          itemId,
          Number(line.quantity),
          saleId,
          `Venta despachada confirmada — ${sale.invoiceNumber || saleId}`
        );
      } catch (invErr) {
        console.warn(`[PendingSales] No se pudo descontar inventario para ${line.productId}:`, invErr.message);
      }
    }

    // 3. Registrar pago
    const paymentMethod = _mapPaymentMethod(sale.paymentMethod);
    await SalePaymentsAPI.create({
      saleId,
      paymentDate: sale.saleDate || new Date().toISOString().slice(0, 10),
      amount:      sale.totals?.revenue ?? 0,
      method:      paymentMethod,
      notes:       `Pago registrado al confirmar despacho — ${sale.invoiceNumber || ''}`,
    });

    // 4. Actualizar inversionista si aplica
    if (sale.isInvestor && _investorRecord) {
      const amortizationTotal = sale.totals?.investor?.amortizationTotal ?? 0;
      if (amortizationTotal > 0) {
        try {
          await InvestorAPI.setSaleAmortization(
            saleId,
            amortizationTotal,
            `Amortización — ${sale.invoiceNumber || saleId}`
          );
        } catch (invErr) {
          console.warn('[PendingSales] Error actualizando inversionista:', invErr.message);
        }
      }
    }

    // 5. Registrar en historial
    const customer = _customerMap.get(sale.clientId);
    await ChangeHistoryAPI.log({
      entity_type: 'sale',
      entity_id:   saleId,
      entity_name: `${sale.invoiceNumber || saleId} — ${customer?.name ?? sale.clientId}`,
      action:      'confirmar',
      changes:     {
        operario:   { before: null, after: sale.operatorName },
        despachado: { before: null, after: sale.createdAt },
        total:      { before: null, after: sale.totals?.revenue },
      },
      user_id:   _currentAdmin.id,
      user_name: _currentAdmin.name,
    });

    _showBanner(`Venta ${sale.invoiceNumber || saleId} confirmada correctamente.`, 'success');
    await _loadAll();

  } catch (err) {
    _showBanner(`Error al confirmar: ${err.message}`, 'error');
    _setBtnLoading(btn, false, '✓ Confirmar');
    if (rejectBtn) rejectBtn.disabled = false;
  }
}

// ─── RECHAZAR VENTA ───────────────────────────────────────────────────────────

async function _handleReject(saleId) {
  const sale = _pendingSales.find(s => s.id === saleId);
  if (!sale) return;

  const reason = window.prompt(
    `¿Por qué rechazas la venta ${sale.invoiceNumber || saleId}?\n(opcional — presiona Cancelar para abortar)`
  );
  if (reason === null) return;  // el usuario canceló

  const btn = document.querySelector(`.ps-reject-btn[data-sale-id="${saleId}"]`);
  const confirmBtn = document.querySelector(`.ps-confirm-btn[data-sale-id="${saleId}"]`);
  _setBtnLoading(btn, true, 'Rechazando…');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const notes = reason.trim()
      ? `Rechazado: ${reason.trim()}`
      : 'Rechazado por administración';

    await SalesAPI.update(saleId, { status: 'rejected', notes });

    const customer = _customerMap.get(sale.clientId);
    await ChangeHistoryAPI.log({
      entity_type: 'sale',
      entity_id:   saleId,
      entity_name: `${sale.invoiceNumber || saleId} — ${customer?.name ?? sale.clientId}`,
      action:      'rechazar',
      changes:     {
        motivo:     { before: null, after: notes },
        operario:   { before: null, after: sale.operatorName },
        despachado: { before: null, after: sale.createdAt },
      },
      user_id:   _currentAdmin.id,
      user_name: _currentAdmin.name,
    });

    _showBanner(`Venta ${sale.invoiceNumber || saleId} rechazada.`, 'success');
    await _loadAll();

  } catch (err) {
    _showBanner(`Error al rechazar: ${err.message}`, 'error');
    _setBtnLoading(btn, false, '✕ Rechazar');
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

// ─── HTML BASE ────────────────────────────────────────────────────────────────

function _buildShellHTML() {
  return `
    <section class="module" id="pending-sales-module">
      <header class="module-header">
        <div class="module-header__title-row">
          <span class="module-header__icon" aria-hidden="true">⊡</span>
          <div>
            <h1 class="module-header__title">Ventas Pendientes</h1>
            <p class="module-header__subtitle">Despachos de CapDispatch que requieren confirmación</p>
          </div>
        </div>
        <div class="module-header__actions">
          <span class="badge" id="ps-count">Cargando…</span>
          <button class="btn btn--sm" id="ps-refresh-btn" title="Recargar lista">↺ Actualizar</button>
        </div>
      </header>

      <div id="ps-banner" class="alert" style="display:none;margin-bottom:var(--space-md)"></div>

      <div id="ps-loading" style="display:none;text-align:center;padding:var(--space-xl)">
        <span class="text-muted">Cargando ventas pendientes…</span>
      </div>

      <div id="ps-list"></div>
    </section>

    <style>
      .ps-card { margin-bottom: var(--space-md); }
      .ps-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        flex-wrap: wrap;
        padding-bottom: var(--space-sm);
        border-bottom: 1px solid var(--color-border);
        margin-bottom: var(--space-sm);
      }
      .ps-card__meta { display: flex; align-items: center; gap: var(--space-xs); flex-wrap: wrap; }
      .ps-card__invoice { font-family: var(--font-mono); font-size: 0.85rem; color: var(--color-text-muted); }
      .ps-card__actions { display: flex; gap: var(--space-xs); }
      .ps-card__body { display: flex; flex-direction: column; gap: var(--space-sm); }
      .ps-card__info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--space-sm);
      }
      .ps-card__info-item { display: flex; flex-direction: column; gap: 2px; }
      .ps-card__info-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.05em; color: var(--color-text-muted); }
      .ps-card__info-value { font-size: 0.95rem; color: var(--color-text-primary); }
      .ps-card__lines { display: flex; flex-direction: column; gap: 4px; }
      .ps-card__lines-header { font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.05em; color: var(--color-text-muted); margin-bottom: 4px; }
      .ps-card__line {
        display: flex; align-items: center; gap: var(--space-sm);
        font-size: 0.88rem; padding: 4px 0;
        border-bottom: 1px solid var(--color-border);
      }
      .ps-card__line:last-child { border-bottom: none; }
      .ps-card__line-name { flex: 1; color: var(--color-text-primary); }
      .ps-card__line-qty { color: var(--color-text-secondary); min-width: 60px; text-align: right; }
      .ps-card__line-price { color: var(--color-text-muted); min-width: 90px; text-align: right; font-family: var(--font-mono); font-size: 0.82rem; }
      .ps-card__total { font-size: 1rem; font-weight: 600; text-align: right;
        color: var(--color-text-primary); padding-top: var(--space-xs); }
      .badge--warning { background: #f39c1220; color: #f39c12; border-color: #f39c12; }
      .badge--info    { background: #4a9eff20; color: #4a9eff; border-color: #4a9eff; }
      .btn--success { background: var(--color-success, #27ae60); color: #fff; border-color: transparent; }
      .btn--success:hover { opacity: 0.85; }
      .btn--sm { padding: 5px 12px; font-size: 0.82rem; }
    </style>`;
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function _fmt(amount) {
  return `RD$${Number(amount).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`;
}

function _fmtDatetime(isoOrMs) {
  if (!isoOrMs) return '—';
  const d = new Date(isoOrMs);
  if (isNaN(d)) return String(isoOrMs);
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function _fmtMethod(method) {
  const map = { cash: 'Efectivo', transfer: 'Transferencia', efectivo: 'Efectivo',
    transferencia: 'Transferencia', cheque: 'Cheque' };
  return map[method] ?? (method || '—');
}

/** Mapea el método de pago de CapDispatch al formato que acepta sale_payments.method */
function _mapPaymentMethod(method) {
  const map = { cash: 'efectivo', transfer: 'transferencia' };
  const mapped = map[method] ?? method;
  const valid = ['efectivo', 'transferencia', 'cheque', 'otro'];
  return valid.includes(mapped) ? mapped : 'efectivo';
}

function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _setLoading(on) {
  const loading = document.getElementById('ps-loading');
  const list    = document.getElementById('ps-list');
  if (loading) loading.style.display = on ? 'block' : 'none';
  if (list    && on) list.innerHTML = '';
}

function _showBanner(msg, type) {
  const el = document.getElementById('ps-banner');
  if (!el) return;
  el.className = `alert alert--${type === 'error' ? 'danger' : 'success'}`;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function _setBtnLoading(btn, on, text) {
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = text;
}
