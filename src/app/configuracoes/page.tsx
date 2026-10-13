import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientRefundRequestPanel } from "@/components/account/client-refund-request-panel";
import { AppNav } from "@/components/layout/app-nav";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { getAuthedContext } from "@/lib/auth/session";
import { loadClientRefundAccess, loadClientRefundPayments } from "@/lib/server/client-refund-page-data";

export const dynamic = "force-dynamic";

const TABS = [{ id: "reembolso", label: "Reembolso" }] as const;

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
  const [auth, platformAdmin] = await Promise.all([
    getAuthedContext(resolvedSearchParams?.store),
    getPlatformAdminAccess(),
  ]);
  if (!auth) redirect("/login");

  const storeId = auth.storeId ?? resolvedSearchParams?.store ?? null;
  const activeTab = TABS.find((tab) => tab.id === resolvedSearchParams?.aba)?.id ?? "reembolso";
  const refundAccess = await loadClientRefundAccess();
  const refundPayments = refundAccess === "allowed" ? await loadClientRefundPayments(auth.orgId ?? null) : [];
  const storeQuery = storeId ? `store=${encodeURIComponent(storeId)}&` : "";

  return (
    <main data-testid="settings-page">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <AppNav role={auth.role ?? null} storeId={storeId} isPlatformAdmin={platformAdmin !== null} />
      </div>
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold text-slate-900">Configurações</h1>
        <nav aria-label="Seções de configurações" className="mt-4 flex gap-2 border-b border-slate-200">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/configuracoes?${storeQuery}aba=${tab.id}`}
              data-testid={`settings-tab-${tab.id}`}
              aria-current={tab.id === activeTab ? "page" : undefined}
              className={
                tab.id === activeTab
                  ? "-mb-px border-b-2 border-slate-900 px-3 py-2 text-sm font-semibold text-slate-900"
                  : "px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
              }
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {activeTab === "reembolso" ? (
          <section
            data-testid="client-refund-slot"
            aria-labelledby="settings-refund-title"
            className="mt-6 rounded-xl border border-slate-200 bg-white p-5"
          >
            <h2 id="settings-refund-title" className="text-lg font-semibold text-slate-900">
              Reembolso
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Peça a análise de reembolso de um pagamento da sua assinatura.
            </p>
            <div className="mt-4">
              {refundAccess === "allowed" && refundPayments.length === 0 ? (
                <p className="text-sm text-slate-700" role="status" data-testid="settings-refund-empty">
                  Nenhum pagamento disponível para reembolso.
                </p>
              ) : (
                <ClientRefundRequestPanel payments={refundPayments} access={refundAccess} />
              )}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
