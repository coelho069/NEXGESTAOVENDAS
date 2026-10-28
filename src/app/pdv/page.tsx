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
import { getAuthedContext, getSessionUser } from "@/lib/auth/session";
import { loadRefundPanel } from "@/lib/server/client-refund-page-data";
import { resolveTenantSubscriptionGate } from "@/lib/server/subscription-access";
import { fixtureStoreOptions, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
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
  // Uma única leitura de sessão para o contexto e para o painel de reembolso.
  const user = await getSessionUser();
  const auth = await getAuthedContext(resolvedSearchParams?.store, user);
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
  // Gate de assinatura e painel de reembolso são independentes: rodam juntos.
  const [gateDecision, refundPanel] = await Promise.all([
    resolveTenantSubscriptionGate({
      orgId: auth?.orgId ?? null,
      userId: user?.id ?? null,
      skip: fixtureMode,
    }),
    fixtureMode
      ? { refundAccess: "allowed" as const, refundPayments: [] }
      : loadRefundPanel(user, auth?.orgId ?? null),
  ]);

  return (
    <main className={`pdv-theme ${inter.variable} ${jakarta.variable}`}>
      <SubscriptionAccessFrame
        orgId={auth?.orgId ?? null}
        userId={auth?.userId}
        role={role}
        skip={fixtureMode}
        decision={gateDecision}
        refundPayments={refundPanel.refundPayments}
        refundAccess={refundPanel.refundAccess}
        refundPlacement="blocked-only"
      >
        <PdvScreen stores={stores} initialStoreId={initialStoreId} role={role} />
      </SubscriptionAccessFrame>
    </main>
  );
}
