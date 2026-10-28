-- Add age column to customers table
ALTER TABLE public.customers
  ADD COLUMN age smallint,
  ADD CONSTRAINT customers_age_check CHECK (age BETWEEN 0 AND 120);
