import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProducts } from "@/hooks/use-products";
import { requestCatalogProducts } from "@/lib/catalog-api";
import { resolveCatalogLoad } from "@/lib/domain/catalog-load";
import { filterActiveProducts, searchProducts, type ProductRow } from "@/lib/domain/product";
import { DEMO_PRODUCTS, DEMO_STORE_CENTRO } from "@/lib/domain/catalog";

// Diagnóstico: fixtures locais, fetch mockado, nenhuma chamada de rede real.

const PRODUCT_A = {
  id: "44444444-4444-4444-8444-444444444401",
  sku: "BEV-001",
  name: "Agua Mineral 500ml",
  unit_price: "3.50",
  barcode: null,
  category_id: null,
  is_active: true,
} as unknown as ProductRow;

const PRODUCT_INACTIVE: ProductRow = { ...PRODUCT_A, id: "x-inactive", sku: "OLD-1", is_active: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("diagnostico: catalogo - resolucao de carga", () => {
  it("lista vazia sem fixtures e sem erro: products [] e error null", () => {
    const r = resolveCatalogLoad({ failed: false, data: [], fixtures: false, fixtureProducts: [] });
    expect(r).toEqual({ products: [], error: null });
  });

  it("falha de API sem fixtures: products [] e erro com status", () => {
    const r = resolveCatalogLoad({
      failed: true,
      data: null,
      fixtures: false,
      fixtureProducts: [],
      cause: { message: "catalog_read_failed", code: "401" },
    });
    expect(r.products).toEqual([]);
    expect(r.error).toBe("Falha ao carregar catálogo: catalog_read_failed (401)");
  });

  it("falha com fixtures ligadas: mostra produtos demo SEM erro (risco se a flag vazar)", () => {
    const r = resolveCatalogLoad({
      failed: true,
      data: null,
      fixtures: true,
      fixtureProducts: DEMO_PRODUCTS,
      cause: { message: "catalog_read_failed", code: "401" },
    });
    expect(r.error).toBeNull();
    expect(r.products.length).toBe(DEMO_PRODUCTS.length);
  });

  it("produtos inativos são removidos por filterActiveProducts", () => {
    expect(filterActiveProducts([PRODUCT_A, PRODUCT_INACTIVE]).map((p) => p.sku)).toEqual(["BEV-001"]);
  });

  it("busca exata por SKU e busca vazia retornam esperado", () => {
    expect(searchProducts([PRODUCT_A], "bev-001")).toEqual([PRODUCT_A]);
    expect(searchProducts([PRODUCT_A], "   ")).toEqual([PRODUCT_A]);
  });
});

describe("diagnostico: requestCatalogProducts (fetch mockado)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sessão sem autorização (401) lança erro com code 401", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));
    await expect(requestCatalogProducts()).rejects.toMatchObject({ code: "401" });
  });

  it("resposta 200 que não é array lança catalog_invalid_response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ products: [] }, 200));
    await expect(requestCatalogProducts()).rejects.toThrow("catalog_invalid_response");
  });

  it("remove inativos e NÃO deduplica produtos repetidos (SKU duplicado chega à grade)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([PRODUCT_A, PRODUCT_A, PRODUCT_INACTIVE]));
    const list = await requestCatalogProducts();
    expect(list.map((p) => p.sku)).toEqual(["BEV-001", "BEV-001"]);
  });
});

describe("diagnostico: useProducts (hook com fetch mockado)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sem loja autorizada: erro 'Selecione uma loja autorizada' e nenhuma chamada de API", async () => {
    const { result } = renderHook(() => useProducts({ storeId: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Selecione uma loja autorizada");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("API 401: loading volta a false, products [] e erro visível", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));
    const { result } = renderHook(() => useProducts({ storeId: DEMO_STORE_CENTRO }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBe("Falha ao carregar catálogo: catalog_read_failed (401)");
  });

  it("API 200 com lista vazia: products [] e sem erro (estado 'vazio' legítimo)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
    const { result } = renderHook(() => useProducts({ storeId: DEMO_STORE_CENTRO }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("reload() após erro recupera a lista", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse([PRODUCT_A]));
    const { result } = renderHook(() => useProducts({ storeId: DEMO_STORE_CENTRO }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await result.current.reload();
    await waitFor(() => expect(result.current.products.length).toBe(1));
    expect(result.current.error).toBeNull();
  });
});
