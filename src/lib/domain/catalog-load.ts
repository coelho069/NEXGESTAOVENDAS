import type { ProductRow } from "@/lib/domain/product";

export type CatalogLoadCause = {
  message?: string | null;
  code?: string | null;
};

const GENERIC_CATALOG_ERROR = "Falha ao carregar catálogo";

export function formatCatalogLoadError(cause?: CatalogLoadCause | string | null): string {
  if (!cause) return GENERIC_CATALOG_ERROR;

  if (typeof cause === "string") {
    const trimmed = cause.trim();
    return trimmed.length > 0 ? `${GENERIC_CATALOG_ERROR}: ${trimmed}` : GENERIC_CATALOG_ERROR;
  }

  const message = cause.message?.trim() ?? "";
  const code = cause.code?.trim() ?? "";
  if (!message && !code) return GENERIC_CATALOG_ERROR;
  if (message && code) return `${GENERIC_CATALOG_ERROR}: ${message} (${code})`;
  if (message) return `${GENERIC_CATALOG_ERROR}: ${message}`;
  return `${GENERIC_CATALOG_ERROR}: ${code}`;
}

export function catalogLoadCauseFromUnknown(cause: unknown): CatalogLoadCause | string | null {
  if (cause == null) return null;
  if (typeof cause === "string") return cause;
  if (typeof cause === "object") {
    const record = cause as { message?: unknown; code?: unknown };
    const message = typeof record.message === "string" ? record.message : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    if (message || code) return { message, code };
  }
  return null;
}

export function resolveCatalogLoad(input: {
  failed: boolean;
  data: ProductRow[] | null;
  fixtures: boolean;
  fixtureProducts: ProductRow[];
  cause?: CatalogLoadCause | string | null;
}): { products: ProductRow[]; error: string | null } {
  if (!input.failed && input.data) {
    return { products: input.data, error: null };
  }
  if (input.fixtures) {
    return { products: input.fixtureProducts, error: null };
  }
  return { products: [], error: formatCatalogLoadError(input.cause) };
}
