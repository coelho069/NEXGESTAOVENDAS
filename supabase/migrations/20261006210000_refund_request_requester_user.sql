-- Local only. Do not apply this file to the hosted project from phase 5.1.
-- New requests record the signed-in client. Existing rows stay NULL.
-- There is no backfill.

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS requester_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'refund_requests_requester_user_id_fkey'
      AND conrelid = 'public.refund_requests'::regclass
  ) THEN
    ALTER TABLE public.refund_requests
      ADD CONSTRAINT refund_requests_requester_user_id_fkey
      FOREIGN KEY (requester_user_id) REFERENCES auth.users (id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.refund_requests.requester_user_id IS
  'Server-derived client user id for refund requests created after this migration. Historical rows remain NULL. The browser cannot set this column.';

CREATE INDEX IF NOT EXISTS refund_requests_requester_user_id_idx
  ON public.refund_requests (requester_user_id);
