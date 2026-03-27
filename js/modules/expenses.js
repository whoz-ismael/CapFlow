/**
 * expenses.js — CapFlow Expenses Module (Category Definitions)
 *
 * Currently exports only the EXPENSE_CATEGORIES constant, which is consumed
 * by reports.js for the expense report filter dropdown.
 *
 * A full expense management UI (CRUD for the `expenses` table) can be added
 * here in the future following the same mountX(container) pattern as other
 * modules. ExpensesAPI in api.js is already implemented and ready.
 *
 * Category labels MUST match what is stored in the `category` column of the
 * expenses table. reports.js also cross-references certain categories via
 * OVERHEAD_CATEGORIES to compute manufacturing overhead costs — keep them
 * in sync.
 *
 * All visible text: Spanish
 * All code identifiers: English
 */

// ─── Expense Categories ──────────────────────────────────────────────────────

/**
 * Master list of expense categories.
 *
 * Shape: Array<{ label: string }>
 *
 * The first group (overhead) is used by reports.js OVERHEAD_CATEGORIES to
 * compute manufacturing cost-per-package. If you rename or remove any of
 * these, update OVERHEAD_CATEGORIES in reports.js accordingly.
 *
 * @type {{ label: string }[]}
 */
export const EXPENSE_CATEGORIES = [
  // ── Manufacturing overhead (matched by reports.js OVERHEAD_CATEGORIES) ──
  { label: 'Electricidad' },
  { label: 'Alquiler \u2014 F\u00e1brica' },
  { label: 'Alquiler \u2014 \u00c1rea de lavado' },
  { label: 'Mantenimiento y reparaciones' },
  { label: 'Agua potable (operarios)' },
  { label: 'Materiales de limpieza' },
  { label: 'Equipos y herramientas' },

  // ── General operating expenses ─────────────────────────────────────────
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
