import { SubscriptionAccessView } from "@/components/auth/subscription-access-view";
import type { ClientRefundPaymentView } from "@/lib/domain/client-refund-eligibility";
import type { RefundGmailAccess } from "@/lib/domain/refund-gmail-access";
import type { MemberRole } from "@/lib/domain/rbac";
import type { SubscriptionGateDecision } from "@/lib/domain/subscription-access";
import { resolveTenantSubscriptionGate } from "@/lib/server/subscription-access";

type SubscriptionAccessFrameProps = {
  orgId: string | null;
  userId?: string | null;
  role: MemberRole | null;
  skip?: boolean;
  refundPayments?: ClientRefundPaymentView[];
  refundAccess?: RefundGmailAccess;
  refundPlacement?: "top" | "bottom" | "blocked-only";
  /** Decisão já resolvida pela página (em paralelo com outros dados); evita refazer o gate. */
  decision?: SubscriptionGateDecision;
  children: React.ReactNode;
};

export async function SubscriptionAccessFrame({
  orgId,
  userId,
  role,
  skip,
  refundPayments = [],
  refundAccess = "allowed",
  refundPlacement = "top",
  decision: precomputedDecision,
  children,
}: SubscriptionAccessFrameProps) {
  const decision =
    precomputedDecision ?? (await resolveTenantSubscriptionGate({ orgId, userId, skip }));
  return (
    <SubscriptionAccessView
      decision={decision}
      role={role}
      refundPayments={refundPayments}
      refundAccess={refundAccess}
      refundPlacement={refundPlacement}
    >
      {children}
    </SubscriptionAccessView>
  );
}
