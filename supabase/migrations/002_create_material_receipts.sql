-- CapFlow — Material Receipts Table
-- Stores raw material entries created by operators via CapDispatch.
-- Operators record type + weight when material arrives at the factory.
-- Admin later confirms each entry in CapFlow by adding supplier and cost,
-- which creates the final record in raw_materials.
--
-- Run this migration in your Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.material_receipts (
  id              TEXT        NOT NULL PRIMARY KEY,
  type            TEXT        NOT NULL,           -- 'recycled' | 'pellet' | 'pellet_regular' | 'colorant'
  receipt_date    DATE        NOT NULL,
  month           TEXT        NOT NULL,           -- YYYY-MM
  weight_lbs      NUMERIC     NOT NULL,
  notes           TEXT,
  operator_name   TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed'
  raw_material_id TEXT        REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS material_receipts_status_idx      ON public.material_receipts (status);
CREATE INDEX IF NOT EXISTS material_receipts_month_idx       ON public.material_receipts (month);
CREATE INDEX IF NOT EXISTS material_receipts_created_at_idx  ON public.material_receipts (created_at DESC);

ALTER TABLE public.material_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read material_receipts"
  ON public.material_receipts FOR SELECT
  USING (true);

CREATE POLICY "Anon can insert material_receipts"
  ON public.material_receipts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anon can update material_receipts"
  ON public.material_receipts FOR UPDATE
  USING (true);
