import { formatBRL } from "@/lib/money";
import type { TrustedOutstanding } from "@/lib/domain/refund-outstanding";

export function accountBalanceNotice(input: {
  approvedUnsentCount: number;
  outstanding: TrustedOutstanding | null;
}): string | null {
  if (input.approvedUnsentCount < 1) return null;
  const outstanding = input.outstanding;
  const prefix = "Aviso de saldo da conta Mercado Pago:";
  const suffix = "A conta precisa ter saldo disponível; sem saldo, o Mercado Pago recusa o estorno.";
  if (!outstanding || outstanding.reliableCount < 1) {
    return `${prefix} há estorno aprovado sem envio e o valor pago está indisponível. ${suffix}`;
  }
  const total = formatBRL(outstanding.reliableTotal);
  const unavailable =
    outstanding.unavailableCount > 0
      ? ` ${outstanding.unavailableCount} pagamento(s) seguem com valor indisponível.`
      : "";
  if (outstanding.reliableCount === 1 && input.approvedUnsentCount === 1) {
    return `${prefix} ${total} em estorno aprovado ainda não foi enviado.${unavailable} ${suffix}`;
  }
  return `${prefix} ${total} em estornos aprovados ainda não foram enviados.${unavailable} ${suffix}`;
}
