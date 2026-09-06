-- B18 prerequisite: commit cash_movement_type.refund_cash before it is referenced.
-- PostgreSQL rejects using a newly added enum value in the same transaction (55P04).
-- This migration exists solely to commit the enum value ahead of
-- 20260905180000_b18_sale_cancel_return.sql.

ALTER TYPE public.cash_movement_type ADD VALUE IF NOT EXISTS 'refund_cash';
