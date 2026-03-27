/**
 * app.js — CapFlow Application Router & Module Loader
 *
 * Handles:
 *  - Authentication gate (Supabase session check on boot)
 *  - Hash-based client-side routing (#products, #dashboard, etc.)
 *  - Lazy-loading module scripts on demand
 *  - Sidebar active-link state
 *
 * To add a new module:
 *  1. Register it in ROUTES below.
 *  2. Create its file under /js/modules/<n>.js
 *  3. Export a mount<n>(container) function from that file.
 */

import { AuthAPI, mountLoginScreen, mountLogoutButton } from './auth.js';

// ─── Route Registry ───────────────────────────────────────────

const ROUTES = {
  dashboard: {
    title: 'Dashboard — CapFlow',
    loader: async (container) => {
      const { mountDashboard } = await import('./modules/dashboard.js');
      await mountDashboard(container);
    },
  },

  products: {
    title: 'Productos — CapFlow',
    loader: async (container) => {
      const { mountProducts } = await import('./modules/products.js');
      mountProducts(container);
    },
  },

  machines: {
    title: 'Máquinas — CapFlow',
    loader: async (container) => {
      const { mountMachines } = await import('./modules/machines.js');
      mountMachines(container);
    },
  },

  production: {
    title: 'Producción — CapFlow',
    loader: async (container) => {
      const { mountProduction } = await import('./modules/production.js');
      await mountProduction(container);
    },
  },

  operators: {
    title: 'Operarios — CapFlow',
    loader: async (container) => {
      const { mountOperators } = await import('./modules/operators.js');
      mountOperators(container);
    },
  },

  'raw-materials': {
    title: 'Materia Prima — CapFlow',
    loader: async (container) => {
      const { mountRawMaterials } = await import('./modules/rawMaterials.js');
      await mountRawMaterials(container);
    },
  },

  clients: {
    title: 'Clientes — CapFlow',
    loader: async (container) => {
      const { mountCustomers } = await import('./modules/customers.js');
      await mountCustomers(container);
    },
  },

  invoicing: {
    title: 'Facturación — CapFlow',
    loader: async (container) => {
      const { mountSales } = await import('./modules/sales.js');
      await mountSales(container);
    },
  },

  inventory: {
    title: 'Inventario — CapFlow',
    loader: async (container) => {
      const { mountInventory } = await import('./modules/inventory.js');
      await mountInventory(container);
    },
  },

  payroll: {
    title: 'Nómina — CapFlow',
    loader: async (container) => {
      const { mountPayroll } = await import('./modules/payroll.js');
      await mountPayroll(container);
    },
  },

  investor: {
    title: 'Inversionista — CapFlow',
    loader: async (container) => {
      const { mountInvestor } = await import('./modules/investor.js');
      await mountInvestor(container);
    },
  },

  expenses: {
    title: 'Gastos — CapFlow',
    loader: async (container) => {
      const { mountExpenses } = await import('./modules/expenses.js');
      await mountExpenses(container);
    },
  },

  reports: {
    title: 'Reportes — CapFlow',
    loader: async (container) => {
      const { mountReports } = await import('./modules/reports.js');
      await mountReports(container);
    },
  },
};

const DEFAULT_ROUTE = 'dashboard';

// ─── Router ───────────────────────────────────────────────────

async function navigate() {
  const hash  = window.location.hash.replace('#', '') || DEFAULT_ROUTE;
  const route = ROUTES[hash] || ROUTES[DEFAULT_ROUTE];

  const container = document.getElementById('view-container');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:40vh;gap:12px;color:var(--color-text-muted);">
      <div class="spinner"></div>
      <span>Cargando…</span>
    </div>
  `;

  document.title = route.title;
  setActiveLink(hash);

  try {
    await route.loader(container);
  } catch (err) {
    container.innerHTML = `
      <div style="padding:40px;color:var(--color-danger);font-family:var(--font-mono);">
        ✕ Error cargando módulo: ${err.message}
      </div>
    `;
    console.error('[CapFlow Router]', err);
  }
}

function setActiveLink(activeRoute) {
  document.querySelectorAll('.sidebar__link[data-route]').forEach(link => {
    const isActive = link.dataset.route === activeRoute;
    link.classList.toggle('sidebar__link--active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

// ─── Placeholder Builder ──────────────────────────────────────

function buildPlaceholder(name, icon, subtitle) {
  return `
    <section class="module">
      <header class="module-header">
        <div class="module-header__left">
          <span class="module-header__icon">${icon}</span>
          <div>
            <h1 class="module-header__title">${name}</h1>
            <p class="module-header__subtitle">${subtitle}</p>
          </div>
        </div>
      </header>
      <div class="card" style="padding:var(--space-2xl);text-align:center;color:var(--color-text-muted);">
        <div style="font-size:3rem;margin-bottom:var(--space-md);">${icon}</div>
        <p>Este módulo estará disponible próximamente.</p>
      </div>
    </section>
  `;
}

// ─── Boot ─────────────────────────────────────────────────────

/**
 * Start the authenticated app: wire up the router and logout button.
 * Called after a confirmed valid session.
 */
function bootApp() {
  // Restore the full #app shell in case it was replaced by the login screen
  const app = document.getElementById('app');
  if (!document.getElementById('sidebar')) {
    // The login screen replaced #app contents — reload to restore HTML shell
    window.location.reload();
    return;
  }

  mountLogoutButton(() => {
    // On logout: reload the page — boot() will detect no session and show login
    window.location.reload();
  });

  window.addEventListener('hashchange', navigate);
  navigate();
}

/**
 * Boot sequence:
 *  1. Check for an existing Supabase session.
 *  2a. Session found → start the app immediately.
 *  2b. No session    → show the login screen, then start the app on success.
 */
async function boot() {
  const session = await AuthAPI.getSession();

  if (session) {
    bootApp();
  } else {
    mountLoginScreen(() => {
      // After successful login the page HTML has been replaced by the login
      // screen, so the cleanest recovery is a full reload — the session cookie
      // is now set and boot() will take the session branch.
      window.location.reload();
    });
  }
}

window.addEventListener('DOMContentLoaded', boot);
