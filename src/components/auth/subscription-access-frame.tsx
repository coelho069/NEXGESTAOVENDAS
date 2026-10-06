import { SubscriptionAccessView } from "@/components/auth/subscription-access-view";
import type { ClientRefundPaymentView } from "@/lib/domain/client-refund-eligibility";
import type { RefundGmailAccess } from "@/lib/domain/refund-gmail-access";
import type { MemberRole } from "@/lib/domain/rbac";
import { resolveTenantSubscriptionGate } from "@/lib/server/subscription-access";

type SubscriptionAccessFrameProps = {
  orgId: string | null;
  role: MemberRole | null;
  skip?: boolean;
  refundPayments?: ClientRefundPaymentView[];
  refundAccess?: RefundGmailAccess;
  children: React.ReactNode;
};

export async function SubscriptionAccessFrame({
  orgId,
  role,
  skip,
  refundPayments = [],
  refundAccess = "allowed",
  children,
}: SubscriptionAccessFrameProps) {
  const decision = await resolveTenantSubscriptionGate({ orgId, skip });
  return (
    <SubscriptionAccessView
      decision={decision}
      role={role}
      refundPayments={refundPayments}
      refundAccess={refundAccess}
    >
      {children}
    </SubscriptionAccessView>
  );
}
