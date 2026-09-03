-- Sprint 1: extensions and domain enums

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE public.sale_status AS ENUM (
  'draft',
  'pending_sync',
  'confirmed',
  'cancelled',
  'refunded',
  'partially_refunded'
);

CREATE TYPE public.payment_status AS ENUM (
  'pending',
  'authorized',
  'captured',
  'failed',
  'cancelled',
  'refunded'
);

CREATE TYPE public.payment_method AS ENUM (
  'cash',
  'card',
  'pix',
  'voucher',
  'other'
);

CREATE TYPE public.sync_status AS ENUM (
  'pending',
  'processing',
  'synced',
  'failed',
  'conflict'
);

CREATE TYPE public.inventory_movement_type AS ENUM (
  'sale',
  'refund',
  'restock',
  'adjustment'
);

CREATE TYPE public.member_role AS ENUM (
  'admin',
  'cashier',
  'manager'
);

CREATE TYPE public.adapter_status AS ENUM (
  'configured',
  'not_configured',
  'error'
);

CREATE TYPE public.fiscal_document_status AS ENUM (
  'not_configured',
  'pending',
  'issued',
  'failed',
  'cancelled'
);
