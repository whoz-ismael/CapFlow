-- ─── MIGRACIÓN 003: Campos de despacho en tabla sales ────────────────────────
-- Agrega columnas necesarias para el flujo de revisión de ventas desde CapDispatch.
--
-- EJECUTAR ESTE SQL EN EL DASHBOARD DE SUPABASE → SQL Editor
--
-- Nuevas columnas:
--   operator_id    → ID del operario que despachó (de dispatch_operators)
--   operator_name  → Nombre del operario para mostrar sin joins
--   payment_method → Método de pago: 'cash' | 'transfer'
--   is_investor    → Si el cliente es el inversionista
--   investor_id    → ID del registro en la tabla investor

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS operator_id    TEXT,
  ADD COLUMN IF NOT EXISTS operator_name  TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS is_investor    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS investor_id    TEXT;

-- Índice para consultas de ventas pendientes de revisión (módulo Ventas Pendientes en CapFlow)
CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales (status);

-- Índice para filtrar por operario
CREATE INDEX IF NOT EXISTS idx_sales_operator_id ON public.sales (operator_id);
