-- CapFlow — Change History Table
-- Run this migration in your Supabase SQL editor to enable change tracking.

CREATE TABLE IF NOT EXISTS public.change_history (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT        NOT NULL,         -- 'product' | 'machine' | etc.
  entity_id   TEXT        NOT NULL,         -- ID of the affected record
  entity_name TEXT,                         -- Human-readable name at time of change
  action      TEXT        NOT NULL,         -- 'crear' | 'editar' | 'activar' | 'desactivar'
  changes     JSONB,                        -- { field: { before, after } }
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for common queries (latest changes, filtered by type)
CREATE INDEX IF NOT EXISTS change_history_entity_type_idx ON public.change_history (entity_type);
CREATE INDEX IF NOT EXISTS change_history_created_at_idx  ON public.change_history (created_at DESC);

-- Enable Row Level Security (allow anonymous reads and inserts for now)
ALTER TABLE public.change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read change history"
  ON public.change_history FOR SELECT
  USING (true);

CREATE POLICY "Anon can insert change history"
  ON public.change_history FOR INSERT
  WITH CHECK (true);
