/** Epic 3 — PIX PDV display helpers (scaffold; wiring stays in pix-qr-sheet / adapters). */

export type PixChargeStatus =
  | "idle"
  | "creating"
  | "awaiting_payment"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "manual_fallback";

export function pixStatusLabel(status: PixChargeStatus): string {
  switch (status) {
    case "idle":
      return "Aguardando";
    case "creating":
      return "Gerando cobrança…";
    case "awaiting_payment":
      return "Aguardando pagamento";
    case "confirmed":
      return "Confirmado";
    case "failed":
      return "Falhou";
    case "cancelled":
      return "Cancelado";
    case "manual_fallback":
      return "PIX manual (contingência)";
    default:
      return status;
  }
}

export type PixQrDisplay = {
  qrCodeImageUrl: string | null;
  copyPastePayload: string | null;
  amount: string;
  status: PixChargeStatus;
};

export function canConfirmPixSale(status: PixChargeStatus): boolean {
  return status === "confirmed";
}

export function shouldShowManualPixFallback(status: PixChargeStatus): boolean {
  return status === "failed" || status === "manual_fallback";
}
