-- Production hardening: exposed roles may read only through the explicitly
-- authorized policies/RPCs. Operational writes remain server-side.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.customers
  FROM anon, authenticated;

DROP POLICY IF EXISTS customers_insert ON public.customers;

REVOKE ALL ON public.integration_outbox
  FROM anon, authenticated;
REVOKE ALL ON public.payment_provider_events
  FROM anon, authenticated;
REVOKE ALL ON public.sale_idempotency_keys
  FROM anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public
  FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- The analytics view is not a Data API surface. Keep it explicitly
-- security-invoker as defense in depth if it is queried by a privileged
-- reporting connection in the future.
ALTER VIEW analytics.product_period_metrics
  SET (security_invoker = true);
REVOKE ALL ON analytics.product_period_metrics
  FROM anon, authenticated, public;
