import { describe, expect, it } from "vitest";
import { normalizedVerifiedGmail, refundGmailAccess } from "@/lib/domain/refund-gmail-access";

const confirmed = "2026-10-01T12:00:00.000Z";

describe("refund Gmail access", () => {
  it("allows a verified Gmail address after trim and lowercase", () => {
    expect(normalizedVerifiedGmail("  USER@GMAIL.COM  ")).toBe("user@gmail.com");
    expect(refundGmailAccess({ email: "  USER@GMAIL.COM  ", emailConfirmedAt: confirmed })).toBe("allowed");
  });

  it("blocks unverified, non-Gmail, empty, and spaced addresses", () => {
    expect(refundGmailAccess(null)).toBe("unauthenticated");
    expect(refundGmailAccess({ email: "user@gmail.com", emailConfirmedAt: null })).toBe("gmail_required");
    expect(refundGmailAccess({ email: "user@gmail.com", emailConfirmedAt: "   " })).toBe("gmail_required");
    expect(refundGmailAccess({ email: "user@outlook.com", emailConfirmedAt: confirmed })).toBe("gmail_required");
    expect(refundGmailAccess({ email: "user@hotmail.com", emailConfirmedAt: confirmed })).toBe("gmail_required");
    expect(refundGmailAccess({ email: "user@yahoo.com", emailConfirmedAt: confirmed })).toBe("gmail_required");
    expect(refundGmailAccess({ email: "", emailConfirmedAt: confirmed })).toBe("gmail_required");
    expect(refundGmailAccess({ email: "user @gmail.com", emailConfirmedAt: confirmed })).toBe("gmail_required");
    expect(normalizedVerifiedGmail("user@gmail.com.evil")).toBeNull();
    expect(normalizedVerifiedGmail("user@foo.gmail.com")).toBeNull();
  });
});
