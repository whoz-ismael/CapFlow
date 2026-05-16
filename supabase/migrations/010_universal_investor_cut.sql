-- Migration 010: Universal Investor Cut
--
-- Every confirmed sale that contains at least one manufactured-cap line
-- now allocates two fixed amounts per package, regardless of customer:
--
--   * RD$100 / paquete  → amortiza la deuda del inversionista (Borbón).
--   * RD$100 / paquete  → queda como "beneficio" físico pendiente de
--                          entregar a Borbón.
--
-- For sales NOT to Borbón, an additional pending amount equal to
-- (unitPrice − 735) per package is owed to Borbón as resale margin.
--
-- Only the RD$100 amortization moves total_debt down immediately; the
-- benefit + margin are tracked separately in `investor_payouts` so the
-- factory can later mark them as physically delivered.
--
-- Borbón-direct sales (client_id = investor.client_id):
--   * Amortization is still recorded (same RD$100/pkg).
--   * NO investor_payouts row is created — Borbón gets the benefit via
--     a price discount at the point of sale, not as a separate payout.
--
-- This migration is idempotent: re-running it does NOT duplicate
-- amortization history entries nor payout rows (NOT EXISTS guards).
--
-- ── 1. New table: investor_payouts ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.investor_payouts (
  id              text         PRIMARY KEY,
  sale_id         text         NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  sale_date       date         NOT NULL,
  packages_total  integer      NOT NULL,
  benefit_total   numeric(14,2) NOT NULL,
  margin_total    numeric(14,2) NOT NULL,
  total_owed      numeric(14,2) GENERATED ALWAYS AS (benefit_total + margin_total) STORED,
  status          text         NOT NULL DEFAULT 'pending',
  delivered_at    timestamptz  NULL,
  delivered_note  text         NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT investor_payouts_status_check CHECK (status IN ('pending','delivered')),
  CONSTRAINT investor_payouts_sale_unique  UNIQUE (sale_id)
);

CREATE INDEX IF NOT EXISTS idx_investor_payouts_status_date
  ON public.investor_payouts (status, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_investor_payouts_sale_id
  ON public.investor_payouts (sale_id);

ALTER TABLE public.investor_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon full access" ON public.investor_payouts;
CREATE POLICY "Anon full access"
  ON public.investor_payouts
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- ── 2. Idempotent backfill of amortizations + payouts ────────────────────────
--
-- Strategy:
--   For every CONFIRMED sale with at least one manufactured line:
--     a) Append an amortization entry to investor.history if none exists
--        for that sale.id. Decrement investor.total_debt by pkg_total*100.
--     b) If the sale's client is NOT Borbón, insert an investor_payouts row
--        (UNIQUE (sale_id) guards against duplicate inserts on re-run).
--   Every action is logged to change_history with source='capflow' and
--   user_name='Sistema (migración 010)'.

DO $$
DECLARE
  inv_record       RECORD;
  sale_rec         RECORD;
  pkg_total        numeric;
  margin_total     numeric;
  amort_amount     numeric;
  benefit_amount   numeric;
  history_jsonb    jsonb;
  has_entry        boolean;
  has_payout       boolean;
  new_entry        jsonb;
  entry_id         text;
  payout_id        text;
  is_borbon        boolean;
  current_debt     numeric;
  ts_ms            bigint;
  sale_date_ms     bigint;
BEGIN
  SELECT id, client_id, total_debt, history
    INTO inv_record
    FROM public.investor
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE '[010] No investor record present — skipping backfill.';
    RETURN;
  END IF;

  history_jsonb := COALESCE(inv_record.history, '[]'::jsonb);
  current_debt  := COALESCE(inv_record.total_debt, 0);

  FOR sale_rec IN
    SELECT
      s.id,
      s.sale_date,
      s.client_id,
      s.invoice_number,
      COALESCE((
        SELECT SUM((line->>'quantity')::numeric)
        FROM jsonb_array_elements(COALESCE(s.lines, '[]'::jsonb)) line
        WHERE line->>'productType' = 'manufactured'
          AND COALESCE((line->>'quantity')::numeric, 0) > 0
      ), 0) AS pkg_total,
      COALESCE((
        SELECT SUM(
          GREATEST(COALESCE((line->>'unitPrice')::numeric, 0) - 735, 0)
          * (line->>'quantity')::numeric
        )
        FROM jsonb_array_elements(COALESCE(s.lines, '[]'::jsonb)) line
        WHERE line->>'productType' = 'manufactured'
          AND COALESCE((line->>'quantity')::numeric, 0) > 0
      ), 0) AS margin_total
    FROM public.sales s
    WHERE s.status = 'confirmed'
      AND s.lines IS NOT NULL
  LOOP
    IF sale_rec.pkg_total <= 0 THEN CONTINUE; END IF;

    amort_amount   := sale_rec.pkg_total * 100;
    benefit_amount := sale_rec.pkg_total * 100;
    is_borbon      := (sale_rec.client_id = inv_record.client_id);
    margin_total   := sale_rec.margin_total;

    -- a) Amortization entry — append only if missing for this sale
    has_entry := EXISTS (
      SELECT 1
      FROM jsonb_array_elements(history_jsonb) h
      WHERE h->>'referenceId' = sale_rec.id
        AND h->>'type'        = 'amortization'
    );

    IF NOT has_entry THEN
      ts_ms        := (extract(epoch from now()) * 1000)::bigint;
      sale_date_ms := (extract(epoch from (sale_rec.sale_date::timestamp + interval '12 hours'))
                       * 1000)::bigint;
      entry_id     := 'inv-' || ts_ms::text || '-' ||
                       substr(md5(random()::text || sale_rec.id), 1, 5);

      new_entry := jsonb_build_object(
        'id',          entry_id,
        'type',        'amortization',
        'amount',      amort_amount,
        'date',        sale_date_ms,
        'referenceId', sale_rec.id,
        'note',        'Venta ' || COALESCE(NULLIF(sale_rec.invoice_number, ''), sale_rec.id)
                       || ' (backfill 010)'
      );
      history_jsonb := history_jsonb || jsonb_build_array(new_entry);
      current_debt  := current_debt - amort_amount;

      INSERT INTO public.change_history
        (entity_type, entity_id, entity_name, action, changes,
         user_id, user_name, source, description)
      VALUES (
        'investor',
        sale_rec.id,
        'Venta ' || COALESCE(NULLIF(sale_rec.invoice_number, ''), sale_rec.id),
        'amortizar',
        jsonb_build_object(
          'amortizacion', jsonb_build_object('before', 0, 'after', amort_amount),
          'paquetes',     jsonb_build_object('before', null, 'after', sale_rec.pkg_total)
        ),
        NULL,
        'Sistema (migración 010)',
        'capflow',
        'Amortización universal por venta manufacturada (backfill 010).'
      );
    END IF;

    -- b) Payout row — only for non-Borbón sales
    IF NOT is_borbon THEN
      has_payout := EXISTS (
        SELECT 1 FROM public.investor_payouts WHERE sale_id = sale_rec.id
      );

      IF NOT has_payout THEN
        ts_ms     := (extract(epoch from now()) * 1000)::bigint;
        payout_id := 'pay-' || ts_ms::text || '-' ||
                      substr(md5(random()::text || sale_rec.id || 'p'), 1, 5);

        INSERT INTO public.investor_payouts
          (id, sale_id, sale_date, packages_total, benefit_total, margin_total, status)
        VALUES (
          payout_id,
          sale_rec.id,
          sale_rec.sale_date,
          sale_rec.pkg_total::integer,
          benefit_amount,
          margin_total,
          'pending'
        );

        INSERT INTO public.change_history
          (entity_type, entity_id, entity_name, action, changes,
           user_id, user_name, source, description)
        VALUES (
          'investor_payout',
          payout_id,
          'Venta ' || COALESCE(NULLIF(sale_rec.invoice_number, ''), sale_rec.id),
          'crear',
          jsonb_build_object(
            'paquetes',  jsonb_build_object('before', null, 'after', sale_rec.pkg_total),
            'beneficio', jsonb_build_object('before', null, 'after', benefit_amount),
            'margen',    jsonb_build_object('before', null, 'after', margin_total)
          ),
          NULL,
          'Sistema (migración 010)',
          'capflow',
          'Pago pendiente a Borbón generado en backfill 010 (beneficio + margen reventa).'
        );
      END IF;
    END IF;
  END LOOP;

  -- Persist the updated investor record once at the end
  UPDATE public.investor
     SET history    = history_jsonb,
         total_debt = current_debt,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   WHERE id = inv_record.id;

  RAISE NOTICE '[010] Backfill complete. Total debt: %.', current_debt;
END $$;
