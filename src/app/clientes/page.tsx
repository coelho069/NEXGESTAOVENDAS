import { landingTheme as t } from "@/components/landing/theme/landing-theme";
import { SubscriptionAccessFrame } from "@/components/auth/subscription-access-frame";
import { CustomersScreen } from "@/components/customers/customers-screen";
import { AppNav } from "@/components/layout/app-nav";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { getAuthedContext } from "@/lib/auth/session";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import type { MemberRole } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/** Mesmo visual do login: fundo escuro, glow radial e cabeçalho de vidro. */
const pageStyle = {
  position: "relative",
  minHeight: "100vh",
  background: t.color.bg,
  color: t.color.text,
  fontFamily: t.font.body,
  colorScheme: "dark",
  overflowX: "hidden",
} as const;
const glowStyle = {
  pointerEvents: "none",
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(900px 480px at 50% -80px, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(16, 185, 129, 0.08) 0%, transparent 65%)",
} as const;
const headerStyle = {
  borderBottom: `1px solid ${t.color.glassBorder}`,
  background: t.color.glassBg,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  // Botões do AppNav são brancos com texto escuro; o cabeçalho herda esse texto.
  color: t.color.primary,
} as const;

function fixtureRoleFromSearch(role: string | undefined): MemberRole {
  if (role === "manager" || role === "admin" || role === "cashier") return role;
  return "cashier";
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; role?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const [auth, platformAdmin] = await Promise.all([
    getAuthedContext(resolvedSearchParams?.store),
    getPlatformAdminAccess(),
  ]);
  const fixtureMode = !auth && pdvFixturesEnabled();
  const role = auth?.role ?? (fixtureMode ? fixtureRoleFromSearch(resolvedSearchParams?.role) : null);
  const storeId = auth?.storeId ?? resolvedSearchParams?.store ?? null;

  return (
    <main style={pageStyle}>
      <div aria-hidden="true" style={glowStyle} />
      <div style={{ position: "relative", zIndex: 1 }}>
      <SubscriptionAccessFrame
        orgId={auth?.orgId ?? null}
        userId={auth?.userId}
        role={role}
        skip={fixtureMode || !auth}
      >
        <div className="px-4 py-3" style={headerStyle}>
          <AppNav role={role} storeId={storeId} isPlatformAdmin={platformAdmin !== null} />
        </div>
        <CustomersScreen />
      </SubscriptionAccessFrame>
      </div>
    </main>
  );
}
