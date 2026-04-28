-- Migration 007: Expenses — Accounts Payable (Cuentas por Pagar)
--
-- Adds support for recording expenses on credit (cuentas por pagar):
--   * New table `service_providers` for non-supplier creditors
--     (e.g. machine repair contractors), distinct from the existing
--     `providers` table used by Materia Prima.
--   * Six new columns on `expenses` to flag an entry as accounts payable
--     and track the creditor, payment status, due date and paid amount.
--
-- Existing expense rows keep their default `is_payable = false`, so reports
-- and dashboards continue to count them on an accrual basis (every expense
-- counts against P&L from its expense_date, paid or unpaid).

-- ─── 1. New table: service_providers ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_providers (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  phone      text,
  notes      text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE service_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon full access" ON service_providers;
CREATE POLICY "Anon full access"
  ON service_providers
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ─── 2. New columns on expenses ──────────────────────────────────────────────

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS is_payable     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creditor_type  text,
  ADD COLUMN IF NOT EXISTS creditor_id    text,
  ADD COLUMN IF NOT EXISTS payable_status text    NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS due_date       date,
  ADD COLUMN IF NOT EXISTS paid_amount    numeric NOT NULL DEFAULT 0;

-- CHECK constraints (added separately with IF NOT EXISTS-style guard via
-- DO block so the migration is idempotent on re-runs).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_creditor_type_check'
  ) THEN
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_creditor_type_check
      CHECK (creditor_type IS NULL OR creditor_type IN ('supplier','service_provider'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_payable_status_check'
  ) THEN
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_payable_status_check
      CHECK (payable_status IN ('unpaid','partial','paid'));
  END IF;
END $$;

-- ─── 3. Helpful index for the AP listing ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_expenses_payable
  ON expenses (is_payable, payable_status);
