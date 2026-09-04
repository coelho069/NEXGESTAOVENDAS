import { describe, expect, it } from "vitest";
import {
  canTransitionSuspendedSale,
  createSnapshotFromCart,
  snapshotToCartLines,
  snapshotTotalMatchesCart,
} from "@/lib/domain/suspended-sale";
import { buildProcessSalePayload } from "@/lib/domain/sale";

const lines = [
  {
    productId: "44444444-4444-4444-8444-444444444401",
    sku: "BEV-001",
    name: "Agua Mineral 500ml",
    unitPrice: "3.50",
    quantity: 2,
    discount: "0.00",
  },
];

describe("suspended sale domain", () => {
  it("allows only suspended -> claimed -> completed, with explicit release", () => {
    expect(canTransitionSuspendedSale("suspended", "claimed")).toBe(true);
    expect(canTransitionSuspendedSale("claimed", "completed")).toBe(true);
    expect(canTransitionSuspendedSale("claimed", "suspended")).toBe(true);
    expect(canTransitionSuspendedSale("completed", "suspended")).toBe(false);
    expect(canTransitionSuspendedSale("completed", "claimed")).toBe(false);
  });

  it("round-trips the immutable snapshot into cart lines", () => {
    const snapshot = createSnapshotFromCart({
      orgId: "11111111-1111-4111-8111-111111111111",
      storeId: "22222222-2222-4222-8222-222222222201",
      operatorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      terminalId: "66666666-6666-4666-8666-666666666666",
      clientMutationId: "77777777-7777-4777-8777-777777777777",
      lines,
      discount: "0.25",
      customerId: null,
      customerName: null,
    });

    expect(snapshot.items[0]?.unit_price).toBe("3.50");
    expect(snapshot.total).toBe("6.75");
    expect(snapshotToCartLines(snapshot)).toEqual(lines);
    expect(snapshotTotalMatchesCart(snapshot, lines, "0.25")).toBe(true);
  });

  it("detects cart conflicts without changing the server snapshot", () => {
    const snapshot = createSnapshotFromCart({
      orgId: "11111111-1111-4111-8111-111111111111",
      storeId: "22222222-2222-4222-8222-222222222201",
      operatorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      terminalId: "66666666-6666-4666-8666-666666666666",
      clientMutationId: "77777777-7777-4777-8777-777777777777",
      lines,
      discount: "0.00",
      customerId: null,
      customerName: null,
    });

    expect(
      snapshotTotalMatchesCart(
        snapshot,
        [{ ...lines[0], quantity: 3 }],
        "0.00"
      )
    ).toBe(false);
    expect(snapshot.items[0]?.quantity).toBe("2.000");
  });

  it("carries the server claim through the existing checkout payload", () => {
    const payload = buildProcessSalePayload(
      "22222222-2222-4222-8222-222222222201",
      "88888888-8888-4888-8888-888888888888",
      lines,
      "cash",
      {
        suspendedSaleId: "99999999-9999-4999-8999-999999999999",
        suspensionClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
      }
    );

    expect(payload.suspended_sale_id).toBe("99999999-9999-4999-8999-999999999999");
    expect(payload.suspension_claim_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab");
    expect(payload.client_mutation_id).toBe("88888888-8888-4888-8888-888888888888");
  });
});
