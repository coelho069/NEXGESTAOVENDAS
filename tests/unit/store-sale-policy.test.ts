import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_SALE_POLICY,
  parseStoreSalePolicy,
} from "@/lib/domain/store-sale-policy";

describe("parseStoreSalePolicy", () => {
  it("defaults to walk-in when settings are missing", () => {
    expect(parseStoreSalePolicy(null)).toEqual(DEFAULT_STORE_SALE_POLICY);
    expect(parseStoreSalePolicy({})).toEqual(DEFAULT_STORE_SALE_POLICY);
  });

  it("reads Centro-style require_customer_on_sale from settings or flat payload", () => {
    expect(
      parseStoreSalePolicy({
        settings: { require_customer_on_sale: true, require_customer_document: false },
      })
    ).toMatchObject({ requireCustomerOnSale: true, requireCustomerDocument: false });
    expect(
      parseStoreSalePolicy({ require_customer_on_sale: true, require_open_cash_session: false })
    ).toMatchObject({ requireCustomerOnSale: true, requireOpenCashSession: false });
  });
});
