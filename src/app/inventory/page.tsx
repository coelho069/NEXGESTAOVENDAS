import { landingTheme as t } from "@/components/landing/theme/landing-theme";
import { SubscriptionAccessFrame } from "@/components/auth/subscription-access-frame";
import { InventoryScreen } from "@/components/inventory/inventory-screen";
import { AppNav } from "@/components/layout/app-nav";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { getAuthedContext } from "@/lib/auth/session";
import { loadInventory } from "@/lib/server/inventory-query";

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

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; cursor?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const [auth, platformAdmin] = await Promise.all([
    getAuthedContext(resolvedSearchParams?.store),
    getPlatformAdminAccess(),
  ]);
  const initial = await loadInventory({
    storeId: resolvedSearchParams?.store,
    cursorSku: resolvedSearchParams?.cursor,
  });

  return (
    <main style={pageStyle}>
      <div aria-hidden="true" style={glowStyle} />
      <div style={{ position: "relative", zIndex: 1 }}>
      <SubscriptionAccessFrame
        orgId={auth?.orgId ?? null}
        userId={auth?.userId}
        role={initial.role}
        skip={!auth}
      >
        <div className="px-4 py-3" style={headerStyle}>
          <AppNav
            role={initial.role}
            storeId={initial.storeId}
            isPlatformAdmin={platformAdmin !== null}
          />
        </div>
        <InventoryScreen storeId={initial.storeId} initial={initial} />
      </SubscriptionAccessFrame>
      </div>
    </main>
  );
}
