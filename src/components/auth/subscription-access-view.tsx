import type { MemberRole } from "@/lib/domain/rbac";
import { canViewReports } from "@/lib/domain/rbac";
import {
  subscriptionBlockTitle,
  type SubscriptionGateDecision,
} from "@/lib/domain/subscription-access";

type SubscriptionAccessViewProps = {
  decision: SubscriptionGateDecision;
  role: MemberRole | null;
  children: React.ReactNode;
};

export function SubscriptionAccessView({
  decision,
  role,
  children,
}: SubscriptionAccessViewProps) {
  if (!decision.allowed) {
    return (
      <section
        role="alert"
        data-testid="subscription-blocked"
        data-effective-state={decision.effectiveState}
        data-reason={decision.reason}
        className="mx-auto max-w-lg p-6"
      >
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-6 text-rose-950">
          <h1 className="text-xl font-semibold">{subscriptionBlockTitle(decision.effectiveState)}</h1>
          <p className="mt-2 text-sm text-rose-800">
            O PDV e as rotas operacionais ficam bloqueados enquanto não houver uma assinatura ativa.
          </p>
          <p className="mt-3 text-xs text-rose-700">
            estado: {decision.effectiveState} · motivo: {decision.reason}
          </p>
        </div>
      </section>
    );
  }

  const showAdminAlert = decision.showAdminValidationAlert && canViewReports(role);

  return (
    <div data-testid="subscription-access-allowed" data-effective-state={decision.effectiveState}>
      {showAdminAlert ? (
        <div
          role="status"
          data-testid="subscription-validation-unavailable-alert"
          data-effective-state="unavailable"
          data-reason={decision.reason}
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <p className="font-semibold">Não foi possível validar a assinatura</p>
          <p className="mt-1 text-amber-800">
            A verificação está indisponível (schema ou consulta). O PDV permanece liberado. Isto não
            é ausência de assinatura.
          </p>
        </div>
      ) : null}
      {children}
    </div>
  );
}
