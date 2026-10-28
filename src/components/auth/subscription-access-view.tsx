import { SubscriptionBlockedActions } from "@/components/auth/subscription-blocked-actions";
import { ClientRefundSlot } from "@/components/account/client-refund-request-panel";
import type { ClientRefundPaymentView } from "@/lib/domain/client-refund-eligibility";
import type { RefundGmailAccess } from "@/lib/domain/refund-gmail-access";
import type { MemberRole } from "@/lib/domain/rbac";
import { canViewReports } from "@/lib/domain/rbac";
import {
  subscriptionBlockTitle,
  type SubscriptionGateDecision,
} from "@/lib/domain/subscription-access";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

/** Cartão de bloqueio: vidro escuro do login com acento rosé. */
const BLOCKED_CARD_STYLE = {
  borderRadius: t.radius.xl,
  border: "1px solid rgba(244, 63, 94, 0.35)",
  background: t.color.glassBg,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: t.shadow.card,
} as const;

/** Aviso de validação indisponível: âmbar escuro (sem superfície clara). */
const WARNING_CARD_STYLE = {
  border: "1px solid rgba(245, 158, 11, 0.35)",
  background: "rgba(245, 158, 11, 0.1)",
} as const;

type SubscriptionAccessViewProps = {
  decision: SubscriptionGateDecision;
  role: MemberRole | null;
  refundPayments?: ClientRefundPaymentView[];
  refundAccess?: RefundGmailAccess;
  refundPlacement?: "top" | "bottom" | "blocked-only";
  children: React.ReactNode;
};

export function SubscriptionAccessView({
  decision,
  role,
  refundPayments = [],
  refundAccess = "allowed",
  refundPlacement = "top",
  children,
}: SubscriptionAccessViewProps) {
  if (!decision.allowed) {
    return (
      <section
        role="alert"
        data-testid="subscription-blocked"
        data-effective-state={decision.effectiveState}
        data-reason={decision.reason}
        className="mx-auto w-full max-w-lg p-6"
      >
        <ClientRefundSlot payments={refundPayments} access={refundAccess} />
        <div className="px-5 py-6" style={BLOCKED_CARD_STYLE}>
          <h1 className="text-xl font-semibold" style={{ color: t.color.text }}>
            {subscriptionBlockTitle(decision.effectiveState, decision.reason)}
          </h1>
          <p className="mt-2 text-sm" style={{ color: t.color.textBody }}>
            O PDV e as rotas operacionais ficam bloqueados enquanto não houver uma assinatura ativa.
          </p>
          <p className="mt-3 text-xs" style={{ color: "#FDA4AF" }}>
            estado: {decision.effectiveState} · motivo: {decision.reason}
          </p>
          <SubscriptionBlockedActions />
        </div>
      </section>
    );
  }

  const showAdminAlert = decision.showAdminValidationAlert && canViewReports(role);

  const refundSlot = <ClientRefundSlot payments={refundPayments} access={refundAccess} />;

  return (
    <div data-testid="subscription-access-allowed" data-effective-state={decision.effectiveState}>
      {refundPlacement === "top" ? refundSlot : null}
      {showAdminAlert ? (
        <div
          role="status"
          data-testid="subscription-validation-unavailable-alert"
          data-effective-state="unavailable"
          data-reason={decision.reason}
          className="px-4 py-3 text-sm"
          style={{ ...WARNING_CARD_STYLE, color: t.color.textBody }}
        >
          <p className="font-semibold" style={{ color: "#FCD34D" }}>Não foi possível validar a assinatura</p>
          <p className="mt-1" style={{ color: t.color.textMuted }}>
            A verificação está indisponível (schema ou consulta). O PDV permanece liberado. Isto não
            é ausência de assinatura.
          </p>
        </div>
      ) : null}
      {children}
      {refundPlacement === "bottom" ? (
        <div className="mx-auto w-full max-w-[1600px] border-t border-border bg-background empty:hidden">
          {refundSlot}
        </div>
      ) : null}
    </div>
  );
}
