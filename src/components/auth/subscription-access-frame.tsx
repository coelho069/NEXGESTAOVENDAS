import { SubscriptionAccessView } from "@/components/auth/subscription-access-view";
import type { MemberRole } from "@/lib/domain/rbac";
import { resolveTenantSubscriptionGate } from "@/lib/server/subscription-access";

type SubscriptionAccessFrameProps = {
  orgId: string | null;
  role: MemberRole | null;
  skip?: boolean;
  children: React.ReactNode;
};

export async function SubscriptionAccessFrame({
  orgId,
  role,
  skip,
  children,
}: SubscriptionAccessFrameProps) {
  const decision = await resolveTenantSubscriptionGate({ orgId, skip });
  return (
    <SubscriptionAccessView decision={decision} role={role}>
      {children}
    </SubscriptionAccessView>
  );
}
