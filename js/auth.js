/**
 * auth.js — CapFlow Authentication
 *
 * Wraps Supabase Auth (email + password).
 * Exposes:
 *   AuthAPI.getSession()  → current session or null
 *   AuthAPI.signIn(email, password) → session or throws
 *   AuthAPI.signOut()     → void
 *   mountLoginScreen(onSuccess) → renders login UI into #app, calls onSuccess on login
 *
 * Used exclusively by app.js — no module imports this directly.
 *
 * All visible text: Spanish | All code identifiers: English
 */

const SUPABASE_URL      = 'https://cyzrxztodzivbxrivkot.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5enJ4enRvZHppdmJ4cml2a290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NjgwODAsImV4cCI6MjA4NzM0NDA4MH0.Ij3BFNwQiMYNVeBOYJ8T5knswO2pJWOp6Z51IiJ3mYg';

// Single shared instance — prevents the "Multiple GoTrueClient instances" warning.
const _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── AuthAPI ──────────────────────────────────────────────────────────────────

export const AuthAPI = {
  async getSession() {
    const { data } = await _client.auth.getSession();
    return data?.session ?? null;
  },

  async signIn(email, password) {
    const { data, error } = await _client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
  },

  async signOut() {
    await _client.auth.signOut();
  },
};

// ─── Login Screen ─────────────────────────────────────────────────────────────

/**
 * Replace the contents of #app with a full-screen login form.
 * Calls onSuccess() once the user is authenticated.
 * @param {() => void} onSuccess
 */
export function mountLoginScreen(onSuccess) {
  _injectLoginStyles();

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-backdrop">
      <div class="login-card">

        <!-- Logo -->
        <div class="login-logo">
          <div class="login-logo__mark" aria-hidden="true"></div>
          <div>
            <span class="login-logo__text">CapFlow</span>
            <span class="login-logo__sub">Sistema ERP</span>
          </div>
        </div>

        <h1 class="login-title">Iniciar sesión</h1>
        <p class="login-subtitle">Acceso restringido al personal autorizado.</p>

        <form id="login-form" novalidate autocomplete="on">
          <div class="login-field">
            <label class="login-label" for="login-email">Correo electrónico</label>
            <input
              class="login-input"
              type="email"
              id="login-email"
              name="email"
              autocomplete="email"
              placeholder="usuario@empresa.com"
              required
            >
            <span class="login-error" id="login-error-email"></span>
          </div>

          <div class="login-field">
            <label class="login-label" for="login-password">Contraseña</label>
            <div class="login-input-wrap">
              <input
                class="login-input"
                type="password"
                id="login-password"
                name="password"
                autocomplete="current-password"
                placeholder="••••••••"
                required
              >
              <button type="button" class="login-toggle-pw" id="login-toggle-pw"
                aria-label="Mostrar contraseña" title="Mostrar/ocultar contraseña">
                👁
              </button>
            </div>
            <span class="login-error" id="login-error-password"></span>
          </div>

          <span class="login-error login-error--general" id="login-error-general"></span>

          <button type="submit" class="login-btn" id="login-submit-btn">
            Entrar
          </button>
        </form>

      </div>
    </div>
  `;

  // ── Listeners ────────────────────────────────────────────────────────────

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    _clearLoginErrors();

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    let valid = true;

    if (!email) {
      document.getElementById('login-error-email').textContent = 'Ingresa tu correo.';
      valid = false;
    }
    if (!password) {
      document.getElementById('login-error-password').textContent = 'Ingresa tu contraseña.';
      valid = false;
    }
    if (!valid) return;

    const btn = document.getElementById('login-submit-btn');
    btn.disabled     = true;
    btn.textContent  = 'Verificando…';

    try {
      await AuthAPI.signIn(email, password);
      onSuccess();
    } catch (err) {
      const msg = _friendlyError(err.message);
      document.getElementById('login-error-general').textContent = msg;
      btn.disabled    = false;
      btn.textContent = 'Entrar';
    }
  });

  // Show/hide password toggle
  document.getElementById('login-toggle-pw').addEventListener('click', () => {
    const input = document.getElementById('login-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Focus email field
  document.getElementById('login-email').focus();
}

// ─── Logout Button ────────────────────────────────────────────────────────────

/**
 * Inject a logout button into the sidebar footer.
 * Called by app.js after a successful auth check.
 * Safe to call multiple times — guards by id.
 * @param {() => void} onLogout
 */
export function mountLogoutButton(onLogout) {
  if (document.getElementById('logout-btn')) return;

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const footer = document.createElement('div');
  footer.className = 'sidebar__logout';
  footer.innerHTML = `
    <button class="sidebar__logout-btn" id="logout-btn" type="button"
      title="Cerrar sesión">
      <span class="sidebar__logout-icon" aria-hidden="true">⏻</span>
      Cerrar sesión
    </button>
  `;
  sidebar.appendChild(footer);

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await AuthAPI.signOut();
    onLogout();
  });
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _clearLoginErrors() {
  document.querySelectorAll('.login-error').forEach(el => (el.textContent = ''));
}

function _friendlyError(msg) {
  if (!msg) return 'Error desconocido.';
  const m = msg.toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid credentials'))
    return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed'))
    return 'La cuenta no ha sido confirmada. Revisa tu correo.';
  if (m.includes('too many requests'))
    return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
  return msg;
}

function _injectLoginStyles() {
  if (document.getElementById('login-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'login-styles';
  tag.textContent = `
    /* ── Full-screen backdrop ── */
    .login-backdrop {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      width: 100%;
      padding: var(--space-lg);
      background-color: var(--color-bg-base);
      background-image:
        linear-gradient(rgba(74,158,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(74,158,255,0.03) 1px, transparent 1px);
      background-size: 40px 40px;
    }

    /* ── Card ── */
    .login-card {
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-2xl) var(--space-xl);
      width: 100%;
      max-width: 420px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.4);
    }

    /* ── Logo ── */
    .login-logo {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      margin-bottom: var(--space-xl);
    }
    .login-logo__mark {
      width: 40px; height: 40px;
      background: var(--color-accent);
      clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
      flex-shrink: 0;
    }
    .login-logo__text {
      font-family: var(--font-display);
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text-primary);
      letter-spacing: 0.05em;
      display: block;
    }
    .login-logo__sub {
      font-size: 0.65rem;
      color: var(--color-text-muted);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      display: block;
      margin-top: -2px;
    }

    /* ── Headings ── */
    .login-title {
      font-size: 1.4rem;
      font-family: var(--font-display);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-text-primary);
      margin: 0 0 var(--space-xs);
    }
    .login-subtitle {
      font-size: 0.82rem;
      color: var(--color-text-muted);
      margin: 0 0 var(--space-xl);
    }

    /* ── Form fields ── */
    .login-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: var(--space-md);
    }
    .login-label {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .login-input-wrap {
      position: relative;
    }
    .login-input {
      width: 100%;
      padding: var(--space-sm) var(--space-md);
      background: var(--color-bg-base);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-family: var(--font-body);
      transition: border-color .15s;
      box-sizing: border-box;
    }
    .login-input:focus {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 2px var(--color-accent-glow);
    }
    .login-toggle-pw {
      position: absolute;
      right: var(--space-sm);
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      color: var(--color-text-muted);
      padding: 2px 4px;
      line-height: 1;
    }
    .login-toggle-pw:hover { color: var(--color-text-primary); }

    /* ── Errors ── */
    .login-error {
      font-size: 0.78rem;
      color: var(--color-danger, #e53e3e);
      min-height: 1em;
    }
    .login-error--general {
      display: block;
      text-align: center;
      margin-bottom: var(--space-sm);
      font-size: 0.85rem;
    }

    /* ── Submit button ── */
    .login-btn {
      width: 100%;
      padding: var(--space-sm) var(--space-md);
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: var(--radius-md);
      font-family: var(--font-display);
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
      transition: opacity .15s, transform .1s;
      margin-top: var(--space-sm);
    }
    .login-btn:hover:not(:disabled)  { opacity: 0.88; }
    .login-btn:active:not(:disabled) { transform: scale(0.98); }
    .login-btn:disabled { opacity: 0.55; cursor: not-allowed; }

    /* ── Sidebar logout footer ── */
    .sidebar__logout {
      position:   sticky;
      bottom:     0;
      background: var(--color-bg-surface);
      border-top: 1px solid var(--color-border);
      padding:    var(--space-sm) var(--space-md);
      flex-shrink: 0;
    }
    .sidebar__logout-btn {
      width:          100%;
      display:        flex;
      align-items:    center;
      gap:            var(--space-sm);
      padding:        10px var(--space-md);
      background:     none;
      border:         none;
      border-left:    3px solid transparent;
      color:          var(--color-text-secondary);
      font-family:    var(--font-display);
      font-weight:    500;
      font-size:      0.95rem;
      letter-spacing: 0.02em;
      cursor:         pointer;
      transition:     background var(--transition-fast), color var(--transition-fast),
                      border-left var(--transition-fast);
      text-align:     left;
    }
    .sidebar__logout-btn:hover {
      background:  var(--color-bg-hover);
      color:       var(--color-danger, #e53e3e);
      border-left: 3px solid var(--color-danger, #e53e3e);
    }
    .sidebar__logout-icon {
      font-size:  1rem;
      width:      20px;
      text-align: center;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(tag);
}
