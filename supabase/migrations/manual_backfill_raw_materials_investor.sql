-- MANUAL backfill — NOT a sequential migration.
-- Run this only AFTER 009_raw_materials_payable_and_investor.sql has been applied
-- and after taking a backup of the `investor` and `raw_materials` tables.
--
-- Purpose
-- -------
-- Before 009, raw_materials carried an `extra->'investorFinancing'` JSON blob
-- of shape {amount, note} and the investor record had a corresponding entry
-- in its history JSONB array with referenceId = raw_materials.id. There was
-- no direct foreign-key-style pointer from raw_materials to that history
-- entry, only the back-reference via referenceId. This script writes the
-- forward link (raw_materials.investor_history_id) and then clears the
-- legacy `extra.investorFinancing` key so the JS code no longer reads it.
--
-- Strategy
-- --------
-- For each raw_materials row where extra ? 'investorFinancing':
--   1. Find the investor.history entry whose referenceId = raw_materials.id.
--      If multiple match (shouldn't happen — referenceId is unique per ref),
--      pick the first by id. If none match, log and skip.
--   2. Set raw_materials.investor_history_id to that entry's id.
--   3. Strip the investorFinancing key from extra so future reads/writes
--      don't keep both representations.
--
-- This script is idempotent: re-running it has no effect on rows that have
-- already been backfilled (investor_history_id IS NOT NULL → skipped).
--
-- HOW TO RUN
-- ----------
-- Option A (psql against the project): \i manual_backfill_raw_materials_investor.sql
-- Option B (Supabase SQL editor): paste this whole file and click Run.
--
-- After running, sanity-check with the SELECTs at the bottom.

BEGIN;

-- Step 1 — backfill investor_history_id from investor.history referenceId.
WITH investor_entries AS (
  SELECT
    h.value->>'id'          AS entry_id,
    h.value->>'referenceId' AS reference_id
  FROM investor i
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.history, '[]'::jsonb)) AS h
  WHERE h.value->>'type' = 'investment'
    AND h.value->>'referenceId' IS NOT NULL
)
UPDATE raw_materials rm
SET    investor_history_id = ie.entry_id,
       updated_at          = now()
FROM   investor_entries ie
WHERE  rm.id = ie.reference_id
  AND  rm.extra ? 'investorFinancing'
  AND  rm.investor_history_id IS NULL;

-- Step 2 — strip the legacy extra.investorFinancing key.
-- Only does anything on rows that were just linked (or were linked previously).
UPDATE raw_materials
SET    extra      = extra - 'investorFinancing',
       updated_at = now()
WHERE  extra ? 'investorFinancing'
  AND  investor_history_id IS NOT NULL;

-- Step 3 — surface any rows that could NOT be linked, so an operator can
-- investigate manually before committing. If this returns rows, ROLLBACK
-- the transaction, fix the data, and re-run.
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM   raw_materials
  WHERE  extra ? 'investorFinancing'
    AND  investor_history_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE 'Backfill warning: % raw_materials rows still carry extra.investorFinancing without a matching history entry. Inspect them before committing.', orphan_count;
  ELSE
    RAISE NOTICE 'Backfill complete: all eligible raw_materials rows linked.';
  END IF;
END $$;

-- Inspect orphans (uncomment to view before COMMIT/ROLLBACK):
-- SELECT id, purchase_date, cost, extra->'investorFinancing' AS legacy
-- FROM   raw_materials
-- WHERE  extra ? 'investorFinancing'
--   AND  investor_history_id IS NULL;

COMMIT;

-- ─── Post-run sanity checks ──────────────────────────────────────────────────
-- 1. Count of linked rows
-- SELECT COUNT(*) AS linked FROM raw_materials WHERE investor_history_id IS NOT NULL;
--
-- 2. Verify referenceId on the investor side matches
-- SELECT rm.id           AS raw_material_id,
--        rm.investor_history_id,
--        h.value->>'referenceId' AS history_reference
-- FROM   raw_materials rm
-- CROSS JOIN LATERAL (
--   SELECT value
--   FROM   investor i
--   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.history, '[]'::jsonb)) AS hh(value)
--   WHERE  hh.value->>'id' = rm.investor_history_id
-- ) h
-- WHERE  rm.investor_history_id IS NOT NULL
-- LIMIT  20;
