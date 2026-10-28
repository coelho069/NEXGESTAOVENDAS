-- ============================================================================
-- Índice para o gate de reembolso (src/lib/server/subscription-access.ts):
--   SELECT ... FROM refund_requests
--   WHERE status IN ('approved', 'refunded') AND payer_email = $1
--
-- payer_email já é gravado normalizado (trim + lower) em
-- src/lib/server/refund-requests.ts, então a consulta usa igualdade
-- (.eq com o valor normalizado), que o índice btree atende. PostgREST não
-- expressa lower(col) em filtros, por isso o índice é sobre a coluna direta.
-- O predicado parcial casa com o IN da consulta e mantém o índice pequeno.
--
-- pg_trgm não está habilitado no projeto; não é necessário para igualdade.
-- ============================================================================

CREATE INDEX IF NOT EXISTS refund_requests_payer_email_approved_idx
  ON public.refund_requests (payer_email)
  WHERE status IN ('approved', 'refunded');
