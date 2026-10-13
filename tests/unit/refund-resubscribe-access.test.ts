import { describe, expect, it } from "vitest";
import { refundBlocksSubscription } from "@/lib/domain/subscription-access";

describe("refundBlocksSubscription", () => {
  it("blocks the subscription that existed at refund time", () => {
    expect(refundBlocksSubscription("2026-10-10T12:00:00.000Z", "2026-10-01T12:00:00.000Z")).toBe(true);
  });
  it("lets a new subscription created after the refund through", () => {
    expect(refundBlocksSubscription("2026-10-10T12:00:00.000Z", "2026-10-12T12:00:00.000Z")).toBe(false);
  });
  it("does not block without refund and blocks when the subscription date is unknown", () => {
    expect(refundBlocksSubscription(null, null)).toBe(false);
    expect(refundBlocksSubscription("2026-10-10T12:00:00.000Z", null)).toBe(true);
  });
});
