import { describe, expect, it } from "vitest";
import { orgHasForeignOpenSubscription } from "@/lib/domain/onboarding-visitor";

const MUTATION = "bc513fbc-6b00-42af-980a-1264a4e19efe";
const PAYMENT = "182542681050";

describe("paid checkout organization", () => {
  it("keeps an organization whose open subscription is this checkout", () => {
    expect(
      orgHasForeignOpenSubscription(
        [{ checkoutClientMutationId: MUTATION, providerRef: PAYMENT }],
        MUTATION,
        PAYMENT
      )
    ).toBe(false);
  });

  it("refuses an organization that already has another open subscription", () => {
    expect(
      orgHasForeignOpenSubscription(
        [{ checkoutClientMutationId: null, providerRef: null }],
        MUTATION,
        PAYMENT
      )
    ).toBe(true);
  });
});
