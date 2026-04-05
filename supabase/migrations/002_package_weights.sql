-- ─── Migration 002: Provider field + Package Weights ─────────────────────────
--
-- 1. Adds `provider` column to material_receipts so CapDispatch can record
--    the supplier when logging raw material entries.
--
-- 2. Creates the `package_weights` table where CapDispatch operators register
--    the weight of a 1,000-cap reference package at the start of their shift.
--    CapFlow reads this table in the Production module so the user knows what
--    value to enter in the "Peso por Paquete (lb)" field.

-- ─── 1. material_receipts — add provider ─────────────────────────────────────

ALTER TABLE public.material_receipts
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT '';

-- ─── 2. package_weights ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.package_weights (
  id            TEXT          PRIMARY KEY,
  weight_lbs    DECIMAL(10,4) NOT NULL,
  operator_name TEXT          NOT NULL DEFAULT '',
  shift_date    DATE          NOT NULL,
  notes         TEXT          NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS package_weights_shift_date_idx
  ON public.package_weights (shift_date DESC);

CREATE INDEX IF NOT EXISTS package_weights_created_at_idx
  ON public.package_weights (created_at DESC);

-- Row-Level Security (same open policies as other shared tables)
ALTER TABLE public.package_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read package weights"
  ON public.package_weights FOR SELECT USING (true);

CREATE POLICY "Anon can insert package weights"
  ON public.package_weights FOR INSERT WITH CHECK (true);
