import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { SubscriptionAccessFrame } from "@/components/auth/subscription-access-frame";
import { PdvScreen } from "@/components/pdv/pdv-screen";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});
import { getAuthedContext } from "@/lib/auth/session";
import { visibleClientRefundPayments, type ClientRefundPaymentView } from "@/lib/domain/client-refund-eligibility";
import {
  normalizedVerifiedGmail,
  refundGmailAccess,
  type RefundGmailAccess,
} from "@/lib/domain/refund-gmail-access";
import { fixtureStoreOptions, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { listOwnedRefundPayments } from "@/lib/server/client-refund-requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/domain/rbac";
import type { StoreOption } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

function fixtureRoleFromSearch(role: string | undefined): MemberRole {
  if (role === "manager" || role === "admin" || role === "cashier") return role;
  return "cashier";
}

export default async function PdvPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; role?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const auth = await getAuthedContext(resolvedSearchParams?.store);
  const fixtureMode = !auth && pdvFixturesEnabled();
  const fixtureRole = fixtureRoleFromSearch(resolvedSearchParams?.role);
  const stores: Array<StoreOption & { role?: MemberRole }> =
    auth?.stores.map(({ id, name, role }) => ({ id, name, role })) ??
    (fixtureMode
      ? fixtureStoreOptions().map((store) => ({ ...store, role: fixtureRole }))
      : []);
  const fixtureStoreId =
    fixtureMode &&
    resolvedSearchParams?.store &&
    stores.some((store) => store.id === resolvedSearchParams.store)
      ? resolvedSearchParams.store
      : null;
  const initialStoreId = auth?.storeId ?? fixtureStoreId;
  const role = auth?.role ?? (fixtureMode ? fixtureRole : null);
  const refundAccess = fixtureMode ? "allowed" : await loadPdvRefundAccess();
  const refundPayments =
    fixtureMode || refundAccess !== "allowed" ? [] : await loadPdvRefundPayments(auth?.orgId ?? null);

  return (
    <main className={`pdv-theme ${inter.variable} ${jakarta.variable}`}>
      <SubscriptionAccessFrame
        orgId={auth?.orgId ?? null}
        role={role}
        skip={fixtureMode}
        refundPayments={refundPayments}
        refundAccess={refundAccess}
      >
        <PdvScreen stores={stores} initialStoreId={initialStoreId} role={role} />
      </SubscriptionAccessFrame>
    </main>
  );
}

async function loadPdvRefundAccess(): Promise<RefundGmailAccess> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return "unauthenticated";
    return refundGmailAccess({
      email: user.email,
      emailConfirmedAt: user.email_confirmed_at,
    });
  } catch {
    return "unauthenticated";
  }
}

async function loadPdvRefundPayments(orgId: string | null): Promise<ClientRefundPaymentView[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const admin = createAdminClient();
    const email = normalizedVerifiedGmail(user?.email);
    const access = refundGmailAccess({
      email: user?.email,
      emailConfirmedAt: user?.email_confirmed_at,
    });
    if (!user?.id || !email || access !== "allowed" || !admin) return [];
    const payments = await listOwnedRefundPayments(admin, {
      userId: user.id,
      email,
      orgId,
    });
    return visibleClientRefundPayments(payments);
  } catch {
    return [];
  }
}
