import { createRefundRequestSchema } from "@/lib/validation/schemas";
import {
  decideRefundReview,
  dispatchMercadoPagoRefund,
  planMercadoPagoRefund,
  refundRequestFingerprint,
} from "@/lib/domain/refund-request";

export const PHASE21_AUDIT_BUTTON_LABEL = "🧪 Executar Testes da Fase 2.1";

export type Phase21CheckStatus = "pass" | "fail";

export type Phase21Check = {
  id: string;
  status: Phase21CheckStatus;
  detail: string;
};

const FORBIDDEN_SNIPPETS = [
  "api.mercadopago.com",
  "refunds.create",
  "stripe.refunds",
  "/v1/payments/",
  "/refunds",
] as const;

export function runPhase21BehaviorChecks(): Phase21Check[] {
  const checks: Phase21Check[] = [];

  const dispatched = dispatchMercadoPagoRefund();
  checks.push({
    id: "provider_refund_disabled",
    status: dispatched.ok === false && dispatched.error === "provider_refund_not_enabled" ? "pass" : "fail",
    detail: "O estorno no provedor permanece desligado.",
  });

  const intent = planMercadoPagoRefund("123456789");
  checks.push({
    id: "provider_intent_not_sent",
    status: intent.dispatch === "not_sent" && intent.provider === "mercadopago" ? "pass" : "fail",
    detail: "O plano de estorno fica em not_sent e não envia nada.",
  });

  const approveSubmitted = decideRefundReview({
    status: "submitted",
    action: "approve",
    windowAssessment: "within_window",
    resolutionNote: "",
    acknowledgeOutsideWindow: false,
  });
  checks.push({
    id: "no_approve_from_submitted",
    status: approveSubmitted.ok === false && approveSubmitted.error === "invalid_transition" ? "pass" : "fail",
    detail: "Pedido só recebido não pode ser aprovado.",
  });

  const outside = decideRefundReview({
    status: "in_review",
    action: "approve",
    windowAssessment: "outside_window",
    resolutionNote: "",
    acknowledgeOutsideWindow: false,
  });
  checks.push({
    id: "outside_window_needs_ack",
    status: outside.ok === false && outside.error === "outside_window_unacknowledged" ? "pass" : "fail",
    detail: "Fora do prazo, a aprovação exige confirmação explícita.",
  });

  const parsed = createRefundRequestSchema.safeParse({
    client_mutation_id: "11111111-1111-4111-8111-111111111111",
    payer_email: "nao-e-email",
    mp_payment_id: "abc",
    reason: "arrependimento",
    intensive_use_declared: false,
  });
  checks.push({
    id: "invalid_request_rejected",
    status: parsed.success ? "fail" : "pass",
    detail: "E-mail e ID inválidos são recusados antes de qualquer gravação.",
  });

  const fingerprint = refundRequestFingerprint({
    payerEmail: "Cliente@Example.com",
    mpPaymentId: "123456789",
    reason: "arrependimento",
    notes: "",
    intensiveUseDeclared: false,
    paidOn: null,
  });
  const again = refundRequestFingerprint({
    payerEmail: "cliente@example.com",
    mpPaymentId: "123456789",
    reason: "arrependimento",
    notes: "",
    intensiveUseDeclared: false,
    paidOn: null,
  });
  checks.push({
    id: "fingerprint_stable",
    status: fingerprint === again && fingerprint.length > 0 ? "pass" : "fail",
    detail: "O mesmo pedido gera a mesma identidade idempotente.",
  });

  return checks;
}

export function runPhase21SourceChecks(files: Record<string, string>): Phase21Check[] {
  const auditAction = files["src/lib/server/refund-phase21-audit-action.ts"] ?? "";
  const auditIsReadOnly =
    auditAction.length > 0 &&
    !auditAction.includes("createAdminClient") &&
    !auditAction.includes("createRefundRequest") &&
    !auditAction.includes("fetch(") &&
    !auditAction.includes("supabase");

  const productSources = Object.entries(files).filter(
    ([path]) => path !== "src/lib/server/refund-phase21-audit-action.ts"
  );
  const productHasForbiddenCall = productSources.some(([, source]) =>
    FORBIDDEN_SNIPPETS.some((snippet) => source.includes(snippet))
  );

  return [
    {
      id: "audit_action_has_no_side_effects",
      status: auditIsReadOnly ? "pass" : "fail",
      detail: "O botão não abre cliente de banco, não cria pedido e não chama a rede.",
    },
    {
      id: "phase2_sources_have_no_provider_refund",
      status: productHasForbiddenCall ? "fail" : "pass",
      detail: "Os arquivos da Fase 2 não chamam refund do Mercado Pago nem da Stripe.",
    },
  ];
}

export function phase21AuditPassed(checks: Phase21Check[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status === "pass");
}
