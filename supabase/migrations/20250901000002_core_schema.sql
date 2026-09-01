-- Sprint 1: core schema (BRL numeric(12,2), timezone America/Sao_Paulo)

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  default_role public.member_role NOT NULL DEFAULT 'cashier',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.store_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role public.member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories (id) ON DELETE SET NULL,
  sku text NOT NULL,
  name text NOT NULL,
  description text,
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  cost_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  barcode text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sku)
);

CREATE TABLE public.inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  quantity numeric(12, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id)
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  document text,
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  cashier_id uuid NOT NULL REFERENCES auth.users (id),
  status public.sale_status NOT NULL DEFAULT 'draft',
  sync_status public.sync_status NOT NULL DEFAULT 'pending',
  client_mutation_id uuid NOT NULL,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, client_mutation_id)
);

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  product_name text NOT NULL,
  product_sku text NOT NULL,
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(12, 2) NOT NULL CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  method public.payment_method NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'pending',
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  adapter_status public.adapter_status NOT NULL DEFAULT 'not_configured',
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL,
  movement_type public.inventory_movement_type NOT NULL,
  quantity_change numeric(12, 3) NOT NULL,
  balance_after numeric(12, 3) NOT NULL CHECK (balance_after >= 0),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores (id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  adapter text NOT NULL DEFAULT 'not_configured',
  status public.fiscal_document_status NOT NULL DEFAULT 'not_configured',
  external_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id)
);

CREATE TABLE public.sale_idempotency_keys (
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  client_mutation_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, client_mutation_id)
);

CREATE INDEX idx_store_members_user ON public.store_members (user_id);
CREATE INDEX idx_products_org_active ON public.products (org_id) WHERE is_active = true;
CREATE INDEX idx_inventory_balances_store_product ON public.inventory_balances (store_id, product_id);
CREATE INDEX idx_sales_store_created ON public.sales (store_id, created_at DESC);
CREATE INDEX idx_audit_logs_org_created ON public.audit_logs (org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.user_has_store_access(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_members sm
    JOIN public.stores s ON s.id = sm.store_id
    WHERE sm.store_id = p_store_id
      AND sm.user_id = auth.uid()
      AND s.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.user_store_role(p_store_id uuid)
RETURNS public.member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sm.role
  FROM public.store_members sm
  WHERE sm.store_id = p_store_id
    AND sm.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_store_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_store_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_store_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_store_role(uuid) TO authenticated;
