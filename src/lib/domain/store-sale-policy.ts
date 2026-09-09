export type StoreSalePolicy = {
  requireCustomerOnSale: boolean;
  requireCustomerDocument: boolean;
  requireOpenCashSession: boolean;
};

export const DEFAULT_STORE_SALE_POLICY: StoreSalePolicy = {
  requireCustomerOnSale: false,
  requireCustomerDocument: false,
  requireOpenCashSession: false,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseStoreSalePolicy(value: unknown): StoreSalePolicy {
  if (!value || typeof value !== "object") {
    return DEFAULT_STORE_SALE_POLICY;
  }
  const row = value as Record<string, unknown>;
  const settings =
    row.settings && typeof row.settings === "object"
      ? (row.settings as Record<string, unknown>)
      : row;
  return {
    requireCustomerOnSale: asBoolean(settings.require_customer_on_sale, false),
    requireCustomerDocument: asBoolean(settings.require_customer_document, false),
    requireOpenCashSession: asBoolean(settings.require_open_cash_session, false),
  };
}
