/**
 * app.js — CapFlow Application Router & Module Loader
 *
 * Handles:
 *  - Hash-based client-side routing (#products, #dashboard, etc.)
 *  - Lazy-loading module scripts on demand
 *  - Sidebar active-link state
 *
 * To add a new module:
 *  1. Register it in ROUTES below.
 *  2. Create its file under /js/modules/<name>.js
 *  3. Export a mount<Name>(container) function from that file.
 */

// ─── Route Registry ───────────────────────────────────────────
/**
 * Each route maps a hash key → { loader, title }
 * loader: async function that returns the module and calls its mount fn.
 */
const ROUTES = {
  dashboard: {
    title: 'Dashboard — CapFlow',
    loader: async (container) => {
      container.innerHTML = buildPlaceholder('Dashboard', '⊞', 'Resumen general del sistema.');
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
      container.innerHTML = buildPlaceholder('Máquinas', '⚙', 'Módulo de máquinas próximamente.');
    },
  },

  production: {
    title: 'Producción — CapFlow',
    loader: async (container) => {
      container.innerHTML = buildPlaceholder('Producción', '⬡', 'Módulo de producción próximamente.');
    },
  },

  clients: {
    title: 'Clientes — CapFlow',
    loader: async (container) => {
      container.innerHTML = buildPlaceholder('Clientes', '◉', 'Módulo de clientes próximamente.');
    },
  },

  invoicing: {
    title: 'Facturación — CapFlow',
    loader: async (container) => {
      container.innerHTML = buildPlaceholder('Facturación', '▤', 'Módulo de facturación próximamente.');
    },
  },

  payroll: {
    title: 'Nómina — CapFlow',
    loader: async (container) => {
      container.innerHTML = buildPlaceholder('Nómina', '◎', 'Módulo de nómina próximamente.');
    },
  },

  investor: {
    title: 'Inversionista — CapFlow',
    loader: async (container) => {
      container.innerHTML = buildPlaceholder('Inversionista', '◇', 'Módulo de inversionista próximamente.');
    },
  },
};

/** Default route if hash is missing or unknown. */
const DEFAULT_ROUTE = 'dashboard';

// ─── Router ───────────────────────────────────────────────────

/** Navigate to the route matching the current URL hash. */
async function navigate() {
  const hash  = window.location.hash.replace('#', '') || DEFAULT_ROUTE;
  const route = ROUTES[hash] || ROUTES[DEFAULT_ROUTE];

  const container = document.getElementById('view-container');
  if (!container) return;

  // Show a brief loading state
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:40vh;gap:12px;color:var(--color-text-muted);">
      <div class="spinner"></div>
      <span>Cargando…</span>
    </div>
  `;

  // Update page title
  document.title = route.title;

  // Highlight active sidebar link
  setActiveLink(hash);

  // Load and mount the module
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

/** Update sidebar link aria-current and CSS class. */
function setActiveLink(activeRoute) {
  document.querySelectorAll('.sidebar__link[data-route]').forEach(link => {
    const isActive = link.dataset.route === activeRoute;
    link.classList.toggle('sidebar__link--active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

// ─── Placeholder Builder ──────────────────────────────────────

/**
 * Returns HTML for a "coming soon" placeholder module view.
 * Used for modules not yet implemented.
 */
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

/** Listen for hash changes and route on initial load. */
window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', navigate);
