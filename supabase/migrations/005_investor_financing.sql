-- 005_investor_financing.sql
-- Adds investor_financing JSONB column to expenses table.
-- Stores metadata when an expense was financed by the investor (lender),
-- e.g. { amount: 500.00, note: "Préstamo para electricidad" }
-- The corresponding investor debt entry is tracked via InvestorAPI.addInvestment
-- with the expense ID as referenceId.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS investor_financing JSONB DEFAULT NULL;
