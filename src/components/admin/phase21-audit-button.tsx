"use client";

import { useState, useTransition } from "react";
import {
  PHASE21_AUDIT_BUTTON_LABEL,
  type Phase21Check,
} from "@/lib/domain/refund-phase21-audit";
import { runPhase21AuditAction } from "@/lib/server/refund-phase21-audit-action";
import { adminActionErrorMessage } from "@/components/admin/admin-action-messages";

export function Phase21AuditButton() {
  const [checks, setChecks] = useState<Phase21Check[] | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await runPhase21AuditAction();
      if (!result.ok) {
        setChecks(null);
        setPassed(null);
        setError(adminActionErrorMessage(result.error));
        return;
      }
      setChecks(result.checks);
      setPassed(result.passed);
    });
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
      >
        {pending ? "Executando verificações…" : PHASE21_AUDIT_BUTTON_LABEL}
      </button>
      <p className="mt-2 text-sm text-muted-foreground">
        Somente leitura: não cria pedido, não grava no banco e não chama Mercado Pago nem Stripe.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      ) : null}
      {passed != null ? (
        <p role="status" className="mt-3 text-sm font-medium">
          {passed ? "Verificações seguras passaram." : "Alguma verificação segura falhou."}
        </p>
      ) : null}
      {checks ? (
        <ul className="mt-3 space-y-2 text-sm">
          {checks.map((check) => (
            <li key={check.id}>
              <span className="font-medium">{check.status === "pass" ? "Passou" : "Falhou"}.</span>{" "}
              {check.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
