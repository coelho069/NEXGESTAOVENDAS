-- Align refund_requests.reason with the domain contract.
-- Not applied to production. Do not run this file against the remote database
-- until that application is explicitly authorized.
--
-- Legacy:
--   desistencia -> arrependimento (same meaning, explicit rewrite)
--   nao_utilizou and any other unknown value are not rewritten and not copied
--   into notes. If such a row exists, this migration stops and rolls back.

LOCK TABLE public.refund_requests IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_reason_check;

DO $$
DECLARE
  legacy_name text;
BEGIN
  SELECT con.conname
  INTO legacy_name
  FROM pg_constraint AS con
  WHERE con.conrelid = 'public.refund_requests'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%desistencia%';

  IF legacy_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.refund_requests DROP CONSTRAINT %I', legacy_name);
  END IF;
END $$;

UPDATE public.refund_requests
SET reason = 'arrependimento'
WHERE reason = 'desistencia';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.refund_requests
    WHERE reason NOT IN (
      'arrependimento',
      'cobranca_indevida',
      'cobranca_duplicada',
      'falha_no_servico',
      'problema_tecnico',
      'outro'
    )
  ) THEN
    RAISE EXCEPTION 'refund_requests_reason_legacy_unmapped'
      USING ERRCODE = '23514',
            HINT = 'desistencia is rewritten to arrependimento. nao_utilizou and any other legacy reason stay unchanged and block this migration.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'refund_requests_reason_domain_check'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
    ALTER TABLE public.refund_requests
      ADD CONSTRAINT refund_requests_reason_domain_check
      CHECK (
        reason IN (
          'arrependimento',
          'cobranca_indevida',
          'cobranca_duplicada',
          'falha_no_servico',
          'problema_tecnico',
          'outro'
        )
      );
  END IF;
END $$;
