-- 006_drop_legacy_clients_table.sql
-- Drops the empty legacy `clients` table.
-- All active customer data lives in the `customers` table (see CustomersAPI in api.js).
-- The `clients` table was never populated — it is safe to remove.

DROP TABLE IF EXISTS public.clients;
