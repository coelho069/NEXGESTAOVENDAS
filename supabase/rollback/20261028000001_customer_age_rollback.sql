-- Rollback: remove age column from customers table
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_age_check,
  DROP COLUMN IF EXISTS age;
