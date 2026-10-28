import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientRefundRequestPanel } from "@/components/account/client-refund-request-panel";
import { ClientLgpdPanel } from "@/components/account/client-lgpd-panel";
import { StoreNameSettings } from "@/components/account/store-name-settings";
import { AppNav } from "@/components/layout/app-nav";
import { RenewSubscriptionButton } from "@/components/auth/renew-subscription-button";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { getAuthedContext, getSessionUser } from "@/lib/auth/session";
import { loadRefundPanel } from "@/lib/server/client-refund-page-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "reembolso", label: "Reembolso" },
  { id: "loja", label: "Loja" },
  { id: "privacidade", label: "Privacidade (LGPD)" },
] as const;

async function loadStoreName(storeId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("stores").select("name").eq("id", storeId).maybeSingle();
  return data?.name ?? "";
}

/** Cartão de vidro igual ao do login (AuthCard). */
const glassCard = {
  borderRadius: t.radius.xl,
  border: `1px solid ${t.color.glassBorder}`,
  background: t.color.glassBg,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: `${t.shadow.card}, 0 0 0 1px rgba(255, 255, 255, 0.03) inset`,
} as const;

/** Botão de ação com o gradiente do nx-login-submit. */
const renewButtonClass =
  "inline-flex items-center justify-center rounded-[12px] px-4 py-2.5 text-sm font-semibold text-white cursor-pointer bg-[linear-gradient(135deg,#2563EB_0%,#1D4ED8_55%,#10B981_100%)] shadow-[0_12px_32px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none";

/**
 * Configurações da conta. Não fica atrás do bloqueio de assinatura: quem está
 * com a assinatura bloqueada ainda precisa conseguir pedir reembolso.
 */
export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams?: Promise<{ store?: string; aba?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const user = await getSessionUser();
  const [auth, platformAdmin] = await Promise.all([
    getAuthedContext(resolvedSearchParams?.store, user),
    getPlatformAdminAccess(),
  ]);
  if (!auth) redirect("/login");

  const storeId = auth.storeId ?? resolvedSearchParams?.store ?? null;
  const activeTab = TABS.find((tab) => tab.id === resolvedSearchParams?.aba)?.id ?? "reembolso";
  const { refundAccess, refundPayments } = await loadRefundPanel(user, auth.orgId ?? null);
  const storeQuery = storeId ? `store=${encodeURIComponent(storeId)}&` : "";
  const storeName = activeTab === "loja" && storeId ? await loadStoreName(storeId) : "";
  const canEditStore = auth.role === "admin" || auth.role === "manager";

  return (
    <main
      data-testid="settings-page"
      style={{
        position: "relative",
        minHeight: "100vh",
        background: t.color.bg,
        color: t.color.text,
        fontFamily: t.font.body,
        WebkitFontSmoothing: "antialiased",
        overflowX: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(900px 480px at 50% -80px, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(16, 185, 129, 0.08) 0%, transparent 65%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "12px 16px",
          borderBottom: `1px solid ${t.color.border}`,
          background: t.color.glassBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <AppNav role={auth.role ?? null} storeId={storeId} isPlatformAdmin={platformAdmin !== null} />
      </div>
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6" style={{ position: "relative", zIndex: 1 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: t.font.heading,
            fontSize: "clamp(22px, 4vw, 26px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: t.color.text,
          }}
        >
          Configurações
        </h1>
        {auth.orgId ? (
          <section
            data-testid="settings-renew"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            style={glassCard}
          >
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: t.color.textBody }}>
              Assinatura: renove para somar mais 30 dias à sua loja atual.
            </p>
            <RenewSubscriptionButton className={renewButtonClass} />
          </section>
        ) : null}
        <nav
          aria-label="Seções de configurações"
          className="mt-5 flex gap-2"
          style={{ borderBottom: `1px solid ${t.color.border}` }}
        >
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <Link
                key={tab.id}
                href={`/configuracoes?${storeQuery}aba=${tab.id}`}
                data-testid={`settings-tab-${tab.id}`}
                aria-current={isActive ? "page" : undefined}
                style={{
                  padding: "8px 12px",
                  marginBottom: -1,
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 500,
                  textDecoration: "none",
                  color: isActive ? t.color.text : t.color.textMuted,
                  borderBottom: isActive ? `2px solid ${t.color.secondary}` : "2px solid transparent",
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {activeTab === "loja" ? (
          <section
            data-testid="settings-store-slot"
            aria-labelledby="settings-store-title"
            className="mt-6 p-5 sm:p-6"
            style={glassCard}
          >
            <h2
              id="settings-store-title"
              style={{
                margin: 0,
                fontFamily: t.font.heading,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: t.color.text,
              }}
            >
              Loja
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.55, color: t.color.textMuted }}>
              Dados da loja usados no PDV e no recibo.
            </p>
            <div className="mt-4">
              {storeId ? (
                <StoreNameSettings storeId={storeId} initialName={storeName} canEdit={canEditStore} />
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: t.color.textBody }}>Nenhuma loja selecionada.</p>
              )}
            </div>
          </section>
        ) : null}
        {activeTab === "reembolso" ? (
          <section
            data-testid="client-refund-slot"
            aria-labelledby="settings-refund-title"
            className="mt-6 p-5 sm:p-6"
            style={glassCard}
          >
            <h2
              id="settings-refund-title"
              style={{
                margin: 0,
                fontFamily: t.font.heading,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: t.color.text,
              }}
            >
              Reembolso
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.55, color: t.color.textMuted }}>
              Peça a análise de reembolso de um pagamento da sua assinatura.
            </p>
            <div className="mt-4">
              {refundAccess === "allowed" && refundPayments.length === 0 ? (
                <p
                  role="status"
                  data-testid="settings-refund-empty"
                  style={{ margin: 0, fontSize: 14, color: t.color.textBody }}
                >
                  Nenhum pagamento disponível para reembolso.
                </p>
              ) : (
                <div
                  style={{
                    borderRadius: t.radius.lg,
                    border: `1px solid ${t.color.borderStrong}`,
                    background: t.color.glassBg,
                    padding: 16,
                  }}
                >
                  <ClientRefundRequestPanel payments={refundPayments} access={refundAccess} />
                </div>
              )}
            </div>
          </section>
        ) : null}
        {activeTab === "privacidade" ? (
          <section
            data-testid="client-lgpd-slot"
            aria-labelledby="settings-lgpd-title"
            className="mt-6 p-5 sm:p-6"
            style={glassCard}
          >
            <h2
              id="settings-lgpd-title"
              style={{
                margin: 0,
                fontFamily: t.font.heading,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: t.color.text,
              }}
            >
              Privacidade (LGPD)
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.55, color: t.color.textMuted }}>
              Como atender pedidos de titulares sobre clientes do PDV e dados da conta.
            </p>
            <div className="mt-4">
              <ClientLgpdPanel />
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
