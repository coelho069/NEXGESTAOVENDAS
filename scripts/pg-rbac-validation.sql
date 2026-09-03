-- pg-rbac-validation.sql — cenários RBAC/RLS obrigatórios (NEX Gestão Vendas).
--
-- Pré-requisitos (ambiente local com Docker):
--   1. supabase db reset --local --yes
--   2. pnpm seed:auth
-- Execução:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f scripts/pg-rbac-validation.sql
--
-- O script roda como superuser local (postgres), cria usuários/produtos de
-- teste próprios dentro de UMA transação e executa ROLLBACK no final:
-- nenhuma linha do seed é alterada. Qualquer asserção que falhe interrompe
-- o script com erro (ON_ERROR_STOP) indicando o cenário.
--
-- Autoridade testada: store_members.role por (auth.uid(), store_id).
-- profiles.default_role NUNCA participa das decisões.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixture: usuários, memberships divergentes, produto e estoque de teste.
-- ---------------------------------------------------------------------------
DO $fixture$
DECLARE
  v_divergent uuid := gen_random_uuid(); -- profile manager / cashier na Loja A
  v_nobody    uuid := gen_random_uuid(); -- profile admin / sem membership
  v_org       uuid := '11111111-1111-4111-8111-111111111111';
  v_store_a   uuid := '22222222-2222-4222-8222-222222222201';
  v_product   uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
  VALUES
    (v_divergent, 'rbac-divergent@test.invalid', 'test-only', now()),
    (v_nobody,    'rbac-nobody@test.invalid',    'test-only', now());

  INSERT INTO public.profiles (id, org_id, full_name, email, default_role)
  VALUES
    (v_divergent, v_org, 'RBAC Divergent', 'rbac-divergent@test.invalid', 'manager'),
    (v_nobody,    v_org, 'RBAC Nobody',    'rbac-nobody@test.invalid',    'admin');

  -- Cenário base: role divergente (perfil manager, membership cashier).
  INSERT INTO public.store_members (org_id, store_id, user_id, role)
  VALUES (v_org, v_store_a, v_divergent, 'cashier');

  INSERT INTO public.products (id, org_id, sku, name, unit_price, cost_price, is_active)
  VALUES (v_product, v_org, 'RBAC-T1', 'RBAC Validation Product', 3.50, 1.00, true);

  INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
  VALUES (v_org, v_store_a, v_product, 10);
  INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
  VALUES (v_org, '22222222-2222-4222-8222-222222222202', v_product, 10);

  PERFORM set_config('test.divergent', v_divergent::text, true);
  PERFORM set_config('test.nobody', v_nobody::text, true);
  PERFORM set_config('test.product', v_product::text, true);
END
$fixture$;

-- ---------------------------------------------------------------------------
-- Cenário 1 — Role divergente: perfil manager, membership cashier.
-- A autoridade é store_members.role; default_role é ignorado.
-- ---------------------------------------------------------------------------
DO $scenario1$
DECLARE
  v_user    uuid := current_setting('test.divergent')::uuid;
  v_store_a uuid := '22222222-2222-4222-8222-222222222201';
  v_role    public.member_role;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  SELECT public.user_store_role(v_store_a) INTO v_role;
  IF v_role IS DISTINCT FROM 'cashier' THEN
    RAISE EXCEPTION 'SCENARIO 1 FAILED: expected cashier, got %', v_role;
  END IF;

  -- Desconto de 20% (limite manager) deve ser rejeitado para o caixa.
  BEGIN
    PERFORM public.assert_sale_discount_cap(v_store_a, 0.20, 1.00);
    RAISE EXCEPTION 'SCENARIO 1 FAILED: 20%% discount accepted for cashier';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE <> '42501' OR SQLERRM NOT LIKE '%discount_limit_exceeded%' THEN
        RAISE EXCEPTION 'SCENARIO 1 FAILED: unexpected error % / %', SQLSTATE, SQLERRM;
      END IF;
  END;

  -- Desconto de 5% (limite cashier) deve passar.
  PERFORM public.assert_sale_discount_cap(v_store_a, 0.05, 1.00);

  -- Relatórios bloqueados para o caixa (apesar do perfil manager).
  BEGIN
    PERFORM public.get_dashboard_metrics(
      jsonb_build_object('store_id', v_store_a, 'from', '2026-09-01', 'to', '2026-09-02'));
    RAISE EXCEPTION 'SCENARIO 1 FAILED: dashboard allowed for cashier';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE <> '42501' OR SQLERRM NOT LIKE '%forbidden_reports%' THEN
        RAISE EXCEPTION 'SCENARIO 1 FAILED: unexpected error % / %', SQLSTATE, SQLERRM;
      END IF;
  END;

  RAISE NOTICE 'PG-RBAC SCENARIO 1 PASSED (role divergente)';
END
$scenario1$;

-- ---------------------------------------------------------------------------
-- Cenário 2 — Sem membership (perfil admin): acesso negado em tudo.
-- ---------------------------------------------------------------------------
DO $scenario2$
DECLARE
  v_user    uuid := current_setting('test.nobody')::uuid;
  v_store_a uuid := '22222222-2222-4222-8222-222222222201';
  v_sales   integer;
  v_stock   integer;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  IF public.user_store_role(v_store_a) IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO 2 FAILED: role resolved without membership';
  END IF;
  IF public.user_has_store_access(v_store_a) THEN
    RAISE EXCEPTION 'SCENARIO 2 FAILED: store access without membership';
  END IF;

  BEGIN
    PERFORM public.assert_sale_discount_cap(v_store_a, 0.00, 1.00);
    RAISE EXCEPTION 'SCENARIO 2 FAILED: discount cap passed without membership';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE <> '42501' OR SQLERRM NOT LIKE '%forbidden_store%' THEN
        RAISE EXCEPTION 'SCENARIO 2 FAILED: unexpected error % / %', SQLSTATE, SQLERRM;
      END IF;
  END;

  SELECT count(*) INTO v_sales FROM public.sales WHERE store_id = v_store_a;
  IF v_sales <> 0 THEN
    RAISE EXCEPTION 'SCENARIO 2 FAILED: RLS leaked % sales', v_sales;
  END IF;

  SELECT count(*) INTO v_stock FROM public.inventory_balances WHERE store_id = v_store_a;
  IF v_stock <> 0 THEN
    RAISE EXCEPTION 'SCENARIO 2 FAILED: RLS leaked % stock rows', v_stock;
  END IF;

  RAISE NOTICE 'PG-RBAC SCENARIO 2 PASSED (sem membership)';
END
$scenario2$;

-- ---------------------------------------------------------------------------
-- Cenário 3 — Acesso à Loja B sem membership nela (só Loja A).
-- ---------------------------------------------------------------------------
DO $scenario3$
DECLARE
  v_user    uuid := current_setting('test.divergent')::uuid;
  v_store_b uuid := '22222222-2222-4222-8222-222222222202';
  v_stock_b integer;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  IF public.user_store_role(v_store_b) IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO 3 FAILED: role resolved for store B without membership';
  END IF;

  BEGIN
    PERFORM public.assert_sale_discount_cap(v_store_b, 0.00, 1.00);
    RAISE EXCEPTION 'SCENARIO 3 FAILED: cap check passed for store B';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE <> '42501' OR SQLERRM NOT LIKE '%forbidden_store%' THEN
        RAISE EXCEPTION 'SCENARIO 3 FAILED: unexpected error % / %', SQLSTATE, SQLERRM;
      END IF;
  END;

  SELECT count(*) INTO v_stock_b FROM public.inventory_balances WHERE store_id = v_store_b;
  IF v_stock_b <> 0 THEN
    RAISE EXCEPTION 'SCENARIO 3 FAILED: RLS leaked % store B rows', v_stock_b;
  END IF;

  RAISE NOTICE 'PG-RBAC SCENARIO 3 PASSED (loja B sem membership)';
END
$scenario3$;

-- ---------------------------------------------------------------------------
-- Cenário 4 — Multi-store: manager na Loja B, cashier na Loja A, ao mesmo
-- tempo; limites de desconto por loja.
-- ---------------------------------------------------------------------------
DO $scenario4$
DECLARE
  v_user    uuid := current_setting('test.divergent')::uuid;
  v_org     uuid := '11111111-1111-4111-8111-111111111111';
  v_store_a uuid := '22222222-2222-4222-8222-222222222201';
  v_store_b uuid := '22222222-2222-4222-8222-222222222202';
  v_role_a  public.member_role;
  v_role_b  public.member_role;
BEGIN
  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO public.store_members (org_id, store_id, user_id, role)
  VALUES (v_org, v_store_b, v_user, 'manager');

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  SELECT public.user_store_role(v_store_a) INTO v_role_a;
  SELECT public.user_store_role(v_store_b) INTO v_role_b;
  IF v_role_a IS DISTINCT FROM 'cashier' OR v_role_b IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'SCENARIO 4 FAILED: roles A=% B=%', v_role_a, v_role_b;
  END IF;

  -- 6% na Loja A (caixa 5%) rejeitado; 20% na Loja B (manager) aceito.
  BEGIN
    PERFORM public.assert_sale_discount_cap(v_store_a, 0.06, 1.00);
    RAISE EXCEPTION 'SCENARIO 4 FAILED: 6%% accepted for cashier in store A';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE <> '42501' OR SQLERRM NOT LIKE '%discount_limit_exceeded%' THEN
        RAISE EXCEPTION 'SCENARIO 4 FAILED: unexpected error % / %', SQLSTATE, SQLERRM;
      END IF;
  END;

  PERFORM public.assert_sale_discount_cap(v_store_b, 0.20, 1.00);

  RAISE NOTICE 'PG-RBAC SCENARIO 4 PASSED (multi-store)';
END
$scenario4$;

-- ---------------------------------------------------------------------------
-- Cenário 5 — Troca de role reflete imediatamente (sem cache) e
-- FK fk_store_members_store_same_org impede membership cross-org.
-- ---------------------------------------------------------------------------
DO $scenario5$
DECLARE
  v_user    uuid := current_setting('test.divergent')::uuid;
  v_org     uuid := '11111111-1111-4111-8111-111111111111';
  v_org2    uuid := gen_random_uuid();
  v_store_a uuid := '22222222-2222-4222-8222-222222222201';
  v_store_b uuid := '22222222-2222-4222-8222-222222222202';
  v_role    public.member_role;
  v_second  uuid := gen_random_uuid();
BEGIN
  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', true);

  UPDATE public.store_members
  SET role = 'manager'
  WHERE user_id = v_user AND store_id = v_store_a;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org2, 'RBAC Org 2', 'rbac-org-2');
  INSERT INTO public.stores (id, org_id, name, code)
  VALUES (v_second, v_org2, 'RBAC Store 2', 'RBAC-2');

  -- Membership cross-org (loja da org 1 com org_id da org 2) é impossível.
  BEGIN
    INSERT INTO public.store_members (org_id, store_id, user_id, role)
    VALUES (v_org, v_second, v_user, 'admin');
    RAISE EXCEPTION 'SCENARIO 5 FAILED: cross-org membership accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN
      IF SQLERRM NOT LIKE '%fk_store_members_store_same_org%' THEN
        RAISE EXCEPTION 'SCENARIO 5 FAILED: wrong FK error %', SQLERRM;
      END IF;
  END;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);
  SELECT public.user_store_role(v_store_a) INTO v_role;
  IF v_role IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'SCENARIO 5 FAILED: role change not reflected (% instead of manager)', v_role;
  END IF;

  EXECUTE 'SET LOCAL ROLE postgres';
  UPDATE public.store_members
  SET role = 'cashier'
  WHERE user_id = v_user AND store_id = v_store_a;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);
  SELECT public.user_store_role(v_store_a) INTO v_role;
  IF v_role IS DISTINCT FROM 'cashier' THEN
    RAISE EXCEPTION 'SCENARIO 5 FAILED: role downgrade not reflected (% instead of cashier)', v_role;
  END IF;

  RAISE NOTICE 'PG-RBAC SCENARIO 5 PASSED (troca de role + FK cross-org)';
END
$scenario5$;

-- ---------------------------------------------------------------------------
-- Cenário 6 — Guarda de provisionamento em profiles (default_role/org_id
-- imutáveis para app roles, mesmo sob policy futura que re-grante UPDATE).
-- ---------------------------------------------------------------------------
DO $scenario6$
DECLARE
  v_user uuid := current_setting('test.divergent')::uuid;
BEGIN
  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', true);

  -- Simula drift futuro de policy re-grantando UPDATE.
  GRANT UPDATE ON public.profiles TO authenticated;
  CREATE POLICY pg_validation_profiles_update ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  BEGIN
    UPDATE public.profiles SET default_role = 'admin' WHERE id = v_user;
    RAISE EXCEPTION 'SCENARIO 6 FAILED: default_role changed by app role';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%profiles_provisioning_columns_immutable%' THEN
        RAISE EXCEPTION 'SCENARIO 6 FAILED: unexpected error %', SQLERRM;
      END IF;
  END;

  BEGIN
    UPDATE public.profiles SET org_id = gen_random_uuid() WHERE id = v_user;
    RAISE EXCEPTION 'SCENARIO 6 FAILED: org_id changed by app role';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%profiles_provisioning_columns_immutable%' THEN
        RAISE EXCEPTION 'SCENARIO 6 FAILED: unexpected error %', SQLERRM;
      END IF;
  END;

  EXECUTE 'SET LOCAL ROLE postgres';
  DROP POLICY pg_validation_profiles_update ON public.profiles;
  REVOKE UPDATE ON public.profiles FROM authenticated;

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.profiles SET full_name = 'x' WHERE id = v_user;
    RAISE EXCEPTION 'SCENARIO 6 FAILED: profiles UPDATE re-granted unexpectedly';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%permission denied%' THEN
        RAISE EXCEPTION 'SCENARIO 6 FAILED: unexpected error %', SQLERRM;
      END IF;
  END;

  RAISE NOTICE 'PG-RBAC SCENARIO 6 PASSED (guarda de provisionamento)';
END
$scenario6$;


-- ---------------------------------------------------------------------------
-- Cenário 7 — Idempotência e integridade do RPC process_sale:
-- replay idêntico permitido, payload divergente rejeitado, exatamente
-- 1 pagamento por venda, baixa de estoque única.
-- ---------------------------------------------------------------------------
DO $scenario7$
DECLARE
  v_user     uuid := current_setting('test.divergent')::uuid;
  v_product  uuid := current_setting('test.product')::uuid;
  v_store_a  uuid := '22222222-2222-4222-8222-222222222201';
  v_mutation uuid := gen_random_uuid();
  v_first    jsonb;
  v_replay   jsonb;
  v_balance  integer;
  v_payload  jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  v_payload := jsonb_build_object(
    'store_id', v_store_a,
    'client_mutation_id', v_mutation,
    'discount', '0.00',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'quantity', 1, 'unit_price', '3.50', 'discount', '0.00')),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', '3.50'))
  );

  SELECT public.process_sale(v_payload) INTO v_first;
  IF (v_first->>'replay')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'SCENARIO 7 FAILED: first call was a replay';
  END IF;

  SELECT public.process_sale(v_payload) INTO v_replay;
  IF (v_replay->>'replay')::boolean IS DISTINCT FROM TRUE
    OR v_replay->>'sale_id' IS DISTINCT FROM v_first->>'sale_id' THEN
    RAISE EXCEPTION 'SCENARIO 7 FAILED: replay divergent (% vs %)', v_first, v_replay;
  END IF;

  -- Payload divergente com o mesmo client_mutation_id é rejeitado.
  v_payload := jsonb_set(v_payload, '{items,0,quantity}', '2');
  v_payload := jsonb_set(v_payload, '{payments,0,amount}', '"7.00"');
  BEGIN
    PERFORM public.process_sale(v_payload);
    RAISE EXCEPTION 'SCENARIO 7 FAILED: divergent payload accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE <> '22023' OR SQLERRM NOT LIKE '%idempotency_payload_mismatch%' THEN
        RAISE EXCEPTION 'SCENARIO 7 FAILED: unexpected error % / %', SQLSTATE, SQLERRM;
      END IF;
  END;

  -- Exatamente 1 pagamento por venda (RPC rejeita payload com 2 pagamentos).
  v_payload := jsonb_build_object(
    'store_id', v_store_a,
    'client_mutation_id', gen_random_uuid(),
    'discount', '0.00',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'quantity', 1, 'unit_price', '3.50', 'discount', '0.00')),
    'payments', jsonb_build_array(
      jsonb_build_object('method', 'cash', 'amount', '3.50'),
      jsonb_build_object('method', 'cash', 'amount', '0.00'))
  );
  BEGIN
    PERFORM public.process_sale(v_payload);
    RAISE EXCEPTION 'SCENARIO 7 FAILED: two-payment payload accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE NOT IN ('22023', '23514') THEN
        RAISE EXCEPTION 'SCENARIO 7 FAILED: unexpected error % / %', SQLSTATE, SQLERRM;
      END IF;
  END;

  -- Baixa de estoque ocorreu exatamente uma vez.
  SELECT quantity INTO v_balance
  FROM public.inventory_balances
  WHERE store_id = v_store_a AND product_id = v_product;
  IF v_balance IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'SCENARIO 7 FAILED: balance % instead of 9', v_balance;
  END IF;

  RAISE NOTICE 'PG-RBAC SCENARIO 7 PASSED (idempotência + 1 pagamento + estoque)';
END
$scenario7$;

-- ---------------------------------------------------------------------------
-- Cenário 8 — Documentos fiscais e auditoria seguem o store_id:
-- membership na Loja A não enxerga registros da Loja B.
-- ---------------------------------------------------------------------------
DO $scenario8$
DECLARE
  v_user       uuid := current_setting('test.divergent')::uuid;
  v_product    uuid := current_setting('test.product')::uuid;
  v_store_a    uuid := '22222222-2222-4222-8222-222222222201';
  v_store_b    uuid := '22222222-2222-4222-8222-222222222202';
  v_payload    jsonb;
  v_fiscal_a   integer;
  v_fiscal_b   integer;
  v_audit_a    integer;
  v_audit_b    integer;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  v_payload := jsonb_build_object(
    'store_id', v_store_a,
    'client_mutation_id', gen_random_uuid(),
    'discount', '0.00',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'quantity', 1, 'unit_price', '3.50', 'discount', '0.00')),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', '3.50'))
  );
  PERFORM public.process_sale(v_payload);

  v_payload := jsonb_set(v_payload, '{store_id}', to_jsonb(v_store_b));
  v_payload := jsonb_set(v_payload, '{client_mutation_id}', to_jsonb(gen_random_uuid()));
  PERFORM public.process_sale(v_payload);

  EXECUTE 'SET LOCAL ROLE postgres';
  UPDATE public.store_members
  SET role = 'manager'
  WHERE user_id = v_user AND store_id = v_store_a;
  DELETE FROM public.store_members
  WHERE user_id = v_user AND store_id = v_store_b;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);

  SELECT count(*) INTO v_fiscal_a
  FROM public.fiscal_documents
  WHERE store_id = v_store_a;
  SELECT count(*) INTO v_fiscal_b
  FROM public.fiscal_documents
  WHERE store_id = v_store_b;
  SELECT count(*) INTO v_audit_a
  FROM public.audit_logs
  WHERE store_id = v_store_a;
  SELECT count(*) INTO v_audit_b
  FROM public.audit_logs
  WHERE store_id = v_store_b;

  IF v_fiscal_a <> 2 OR v_fiscal_b <> 0 OR v_audit_a <> 2 OR v_audit_b <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO 8 FAILED: fiscal A=% B=%; audit A=% B=%',
      v_fiscal_a, v_fiscal_b, v_audit_a, v_audit_b;
  END IF;

  RAISE NOTICE 'PG-RBAC SCENARIO 8 PASSED (fiscal + audit store scope)';
END
$scenario8$;

SELECT 'PG-RBAC-VALIDATION: ALL SCENARIOS PASSED' AS result;

ROLLBACK;
