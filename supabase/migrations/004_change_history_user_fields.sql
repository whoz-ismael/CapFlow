-- ─── MIGRACIÓN 004: Campos de usuario en change_history ─────────────────────
-- Agrega user_id y user_name a la tabla change_history para saber quién
-- realizó cada acción registrada en el Historial de CapFlow.
--
-- Esta migración ya fue aplicada vía Supabase MCP.
-- Se incluye aquí como referencia y para entornos nuevos.

ALTER TABLE public.change_history
  ADD COLUMN IF NOT EXISTS user_id   TEXT,
  ADD COLUMN IF NOT EXISTS user_name TEXT;

-- Nota: los registros existentes tendrán NULL en estas columnas,
-- y el Historial los mostrará sin chip de usuario (comportamiento correcto).
