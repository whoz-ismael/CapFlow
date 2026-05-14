-- ─── MIGRACIÓN 008: source + description en change_history ──────────────────
-- Agrega:
--   • source       — origen del cambio ('capflow' | 'capdispatch' | 'sistema')
--                    Permite distinguir, por ejemplo, los despachos que llegan
--                    desde la app de CapDispatch.
--   • description  — mensaje pre-generado en lenguaje natural (opcional).
--                    El módulo de Historial igualmente puede derivar el texto
--                    a partir de entity_type/action/changes; este campo está
--                    disponible para casos donde el origen quiera escribir su
--                    propio resumen (por ej. la sync de CapDispatch).
--
-- Esta migración ya fue aplicada vía Supabase MCP. Se incluye aquí como
-- referencia y para entornos nuevos.

ALTER TABLE public.change_history
  ADD COLUMN IF NOT EXISTS source      TEXT DEFAULT 'capflow',
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS change_history_source_idx ON public.change_history (source);
CREATE INDEX IF NOT EXISTS change_history_action_idx ON public.change_history (action);
