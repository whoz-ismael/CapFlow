-- Migration 011: investor_payouts.give_margin_to_investor + rejected-sale cleanup
--
-- 1. Add an explicit flag per payout indicating whether the resale margin
--    (unitPrice − 735 per package) is owed to Borbón for that sale. The
--    two RD$100 buckets stay mandatory and unchanged. Default true so
--    every existing row keeps its current behavior.
--
-- 2. Backfill / data-integrity fix:
--    Sales that were rejected through the Ventas Pendientes flow must
--    NOT carry an amortization entry in `investor.history` nor a row in
--    `investor_payouts`. Reverse any such residue, restore total_debt,
--    delete the payout row, and log each cleanup to change_history.
--
-- This migration is idempotent: re-running it adds nothing new.

-- ── 1. New column ────────────────────────────────────────────────────────────

ALTER TABLE public.investor_payouts
  ADD COLUMN IF NOT EXISTS give_margin_to_investor boolean NOT NULL DEFAULT true;

-- ── 2. Cleanup pass for rejected sales ───────────────────────────────────────

DO $$
DECLARE
  inv_record       RECORD;
  sale_rec         RECORD;
  history_jsonb    jsonb;
  current_debt     numeric;
  entry            jsonb;
  amort_amount     numeric;
  amort_count      integer := 0;
  payout_count     integer := 0;
  payout_row       RECORD;
BEGIN
  SELECT id, total_debt, history
    INTO inv_record
    FROM public.investor
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE '[011] No investor record present — skipping rejected backfill.';
    RETURN;
  END IF;

  history_jsonb := COALESCE(inv_record.history, '[]'::jsonb);
  current_debt  := COALESCE(inv_record.total_debt, 0);

  FOR sale_rec IN
    SELECT s.id, s.invoice_number
      FROM public.sales s
     WHERE s.status = 'rejected'
  LOOP
    -- a) Reverse the amortization entry (if any) for this sale.
    SELECT h INTO entry
      FROM jsonb_array_elements(history_jsonb) h
     WHERE h->>'referenceId' = sale_rec.id
       AND h->>'type'        = 'amortization'
     LIMIT 1;

    IF entry IS NOT NULL THEN
      amort_amount := COALESCE((entry->>'amount')::numeric, 0);

      history_jsonb := COALESCE((
        SELECT jsonb_agg(h)
          FROM jsonb_array_elements(history_jsonb) h
         WHERE NOT (h->>'referenceId' = sale_rec.id
                    AND h->>'type'    = 'amortization')
      ), '[]'::jsonb);
      current_debt := current_debt + amort_amount;
      amort_count  := amort_count + 1;

      INSERT INTO public.change_history
        (entity_type, entity_id, entity_name, action, changes,
         user_id, user_name, source, description)
      VALUES (
        'investor',
        sale_rec.id,
        'Venta ' || COALESCE(NULLIF(sale_rec.invoice_number, ''), sale_rec.id),
        'revertir',
        jsonb_build_object(
          'entry_id',     entry->>'id',
          'amortizacion', jsonb_build_object('before', amort_amount, 'after', 0),
          'motivo',       'Venta rechazada — amortización revertida'
        ),
        NULL,
        'Sistema (migración 011)',
        'capflow',
        'Reversión de amortización de venta rechazada (backfill 011).'
      );
    END IF;

    -- b) Delete the payout row (if any) for this sale.
    SELECT id, packages_total, benefit_total, margin_total, total_owed
      INTO payout_row
      FROM public.investor_payouts
     WHERE sale_id = sale_rec.id
     LIMIT 1;

    IF FOUND THEN
      DELETE FROM public.investor_payouts WHERE sale_id = sale_rec.id;
      payout_count := payout_count + 1;

      INSERT INTO public.change_history
        (entity_type, entity_id, entity_name, action, changes,
         user_id, user_name, source, description)
      VALUES (
        'investor_payout',
        payout_row.id,
        'Venta ' || COALESCE(NULLIF(sale_rec.invoice_number, ''), sale_rec.id),
        'eliminar',
        jsonb_build_object(
          'paquetes',  jsonb_build_object('before', payout_row.packages_total, 'after', null),
          'beneficio', jsonb_build_object('before', payout_row.benefit_total,  'after', null),
          'margen',    jsonb_build_object('before', payout_row.margin_total,   'after', null),
          'total',     jsonb_build_object('before', payout_row.total_owed,     'after', null),
          'motivo',    'Venta rechazada — entrega pendiente eliminada'
        ),
        NULL,
        'Sistema (migración 011)',
        'capflow',
        'Eliminación de entrega pendiente de venta rechazada (backfill 011).'
      );
    END IF;
  END LOOP;

  UPDATE public.investor
     SET history    = history_jsonb,
         total_debt = current_debt,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   WHERE id = inv_record.id;

  RAISE NOTICE '[011] Rejected-sale backfill: % amortizations reversed, % payouts removed. Total debt: %.',
               amort_count, payout_count, current_debt;
END $$;
