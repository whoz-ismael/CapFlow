-- Migration 009: Raw Materials — Accounts Payable + Investor Linkage
--
-- Brings raw_materials to feature parity with the expenses table:
--
--   * Adds six "cuenta por pagar" columns (is_payable, creditor_type,
--     creditor_id, payable_status, due_date, paid_amount) so a purchase
--     can be marked as bought on credit. Inventory is still consumed
--     immediately; only the cash obligation is tracked separately and
--     reconciled later (usually on the monthly cutoff, day 15).
--
--   * Adds investor_history_id (text, nullable) holding a direct reference
--     to an entry inside the investor record's history JSON array. This
--     replaces the legacy `extra.investorFinancing` JSON blob and gives
--     bidirectional linkage: raw_materials.investor_history_id <-> the
--     entry's id, while investor.history[i].referenceId points back to
--     raw_materials.id. Edits and deletes on either side can now cascade.
--
-- Mutual exclusion rule — a purchase cannot be BOTH an account payable
-- AND investor-financed at the same time. This is enforced in the UI,
-- in the API layer, and at the DB level via a CHECK constraint. The
-- semantics: if the money came from the investor, it's not a CxP; if
-- it's a CxP, the investor isn't fronting it.
--
-- Defaults preserve existing rows: is_payable=false, payable_status='unpaid',
-- paid_amount=0, and all other new columns NULL. No data movement here —
-- backfill from extra.investorFinancing is a separate manual script,
-- see manual_backfill_raw_materials_investor.sql.

-- ─── 1. New columns on raw_materials ─────────────────────────────────────────

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS is_payable          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creditor_type       text,
  ADD COLUMN IF NOT EXISTS creditor_id         text,
  ADD COLUMN IF NOT EXISTS payable_status      text    NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS due_date            date,
  ADD COLUMN IF NOT EXISTS paid_amount         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS investor_history_id text;

-- ─── 2. CHECK constraints ────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_creditor_type_check'
  ) THEN
    ALTER TABLE raw_materials
      ADD CONSTRAINT raw_materials_creditor_type_check
      CHECK (creditor_type IS NULL OR creditor_type IN ('supplier','service_provider'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_payable_status_check'
  ) THEN
    ALTER TABLE raw_materials
      ADD CONSTRAINT raw_materials_payable_status_check
      CHECK (payable_status IN ('unpaid','partial','paid'));
  END IF;

  -- Mutual exclusion: a purchase cannot be both AP and investor-financed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_payable_xor_investor_check'
  ) THEN
    ALTER TABLE raw_materials
      ADD CONSTRAINT raw_materials_payable_xor_investor_check
      CHECK (NOT (is_payable = true AND investor_history_id IS NOT NULL));
  END IF;
END $$;

-- ─── 3. Index for the AP listing / filters ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_raw_materials_payable
  ON raw_materials (is_payable, payable_status);
