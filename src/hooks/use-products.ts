"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import { filterActiveProducts, type ProductRow } from "@/lib/domain/product";
import {
  catalogLoadCauseFromUnknown,
  resolveCatalogLoad,
  type CatalogLoadCause,
} from "@/lib/domain/catalog-load";
import { fixtureProducts, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { createClient } from "@/lib/supabase/client";

export function shouldReloadCatalogOnAuthEvent(event: AuthChangeEvent): boolean {
  switch (event) {
    case "SIGNED_IN":
    case "SIGNED_OUT":
      return true;
    case "INITIAL_SESSION":
    case "TOKEN_REFRESHED":
    case "USER_UPDATED":
    case "PASSWORD_RECOVERY":
    case "MFA_CHALLENGE_VERIFIED":
      return false;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function applyCatalogResult(
  failed: boolean,
  data: ProductRow[] | null,
  cause?: CatalogLoadCause | string | null
) {
  const resolved = resolveCatalogLoad({
    failed,
    data: data ? filterActiveProducts(data) : null,
    fixtures: pdvFixturesEnabled(),
    fixtureProducts: filterActiveProducts(fixtureProducts()),
    cause,
  });
  return resolved;
}

type LoadOptions = {
  background?: boolean;
};

export function useProducts(options: { storeId?: string | null } = {}) {
  const { storeId = null } = options;
  const [products, setProducts] = useState<ProductRow[]>(() =>
    pdvFixturesEnabled() ? filterActiveProducts(fixtureProducts()) : []
  );
  const [loading, setLoading] = useState(() => !pdvFixturesEnabled());
  const [error, setError] = useState<string | null>(null);
  const [fromCatalog, setFromCatalog] = useState(false);
  const loadGenerationRef = useRef(0);
  const hasProductsRef = useRef(
    pdvFixturesEnabled() ? filterActiveProducts(fixtureProducts()).length > 0 : false
  );

  const load = useCallback(async (loadOptions: LoadOptions = {}) => {
    const generation = ++loadGenerationRef.current;
    const background = loadOptions.background ?? false;

    if (!background) {
      setLoading(true);
    }

    if (!storeId && !pdvFixturesEnabled()) {
      if (generation !== loadGenerationRef.current) {
        return;
      }
      setProducts([]);
      setFromCatalog(false);
      setError("Selecione uma loja autorizada");
      hasProductsRef.current = false;
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("products")
        .select("id, sku, name, unit_price, barcode, category_id, is_active")
        .order("name");

      if (generation !== loadGenerationRef.current) {
        return;
      }

      const resolved = applyCatalogResult(
        Boolean(queryError) || !data,
        (data as ProductRow[] | null) ?? null,
        queryError ? { message: queryError.message, code: queryError.code } : null
      );
      setProducts(resolved.products);
      setFromCatalog(false);
      setError(resolved.error);
      hasProductsRef.current = resolved.products.length > 0;
    } catch (cause) {
      if (generation !== loadGenerationRef.current) {
        return;
      }
      const resolved = applyCatalogResult(true, null, catalogLoadCauseFromUnknown(cause));
      setProducts(resolved.products);
      setFromCatalog(false);
      setError(resolved.error);
      hasProductsRef.current = resolved.products.length > 0;
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [storeId]);

  useEffect(() => {
    // Reload when storeId becomes available or changes.
    void load();
  }, [load]);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (!shouldReloadCatalogOnAuthEvent(event)) {
        return;
      }
      void load({ background: hasProductsRef.current });
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [load]);

  return { products, loading, error, reload: load, fromCatalog };
}
