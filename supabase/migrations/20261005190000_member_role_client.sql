-- Client accounts are tenant members, not store operators.
-- Adding the enum value is the whole migration: Postgres cannot use a new
-- enum value in the same transaction that creates it.
ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'client';
