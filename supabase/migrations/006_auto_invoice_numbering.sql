-- Migration 006: Auto-invoice numbering
--
-- Creates a counter table and an atomic Postgres function to generate
-- sequential invoice numbers per prefix (FAC- for CapFlow, DISP- for CapDispatch).
-- This replaces the non-atomic client-side approach and prevents duplicate numbers
-- under concurrent inserts.

-- ─── 1. Counter table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_counters (
  prefix      text    PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

-- ─── 2. Seed counters from existing data ──────────────────────────────────────

-- FAC- (CapFlow direct sales)
INSERT INTO invoice_counters (prefix, last_number)
VALUES (
  'FAC-',
  COALESCE((
    SELECT MAX(substring(invoice_number FROM 5)::integer)
    FROM sales
    WHERE invoice_number ~ '^FAC-[0-9]+$'
  ), 0)
)
ON CONFLICT (prefix) DO UPDATE SET last_number = EXCLUDED.last_number;

-- DISP- (CapDispatch operator dispatches)
INSERT INTO invoice_counters (prefix, last_number)
VALUES (
  'DISP-',
  COALESCE((
    SELECT MAX(substring(invoice_number FROM 6)::integer)
    FROM sales
    WHERE invoice_number ~ '^DISP-[0-9]+$'
  ), 0)
)
ON CONFLICT (prefix) DO UPDATE SET last_number = EXCLUDED.last_number;

-- ─── 3. Atomic next-number function ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION next_invoice_number(p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_num integer;
BEGIN
  -- Atomic increment: grab the updated counter in a single statement
  UPDATE invoice_counters
  SET last_number = last_number + 1
  WHERE prefix = p_prefix
  RETURNING last_number INTO v_num;

  -- If this prefix has never been used, create the row starting at 1
  IF v_num IS NULL THEN
    INSERT INTO invoice_counters (prefix, last_number)
    VALUES (p_prefix, 1)
    ON CONFLICT (prefix) DO UPDATE
      SET last_number = invoice_counters.last_number + 1
    RETURNING last_number INTO v_num;
  END IF;

  -- Return zero-padded number: FAC-001, DISP-007, etc.
  RETURN p_prefix || lpad(v_num::text, 3, '0');
END;
$$;
