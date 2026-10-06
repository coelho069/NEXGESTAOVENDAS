export type MercadoPagoPaymentIpn = {
  id: string;
  type: "payment";
  action: "payment.updated";
  data: { id: string };
};

/** IPN do Checkout Pro. O painel antigo avisa a raiz; a preferência usa esta rota. */
export function buildMercadoPagoNotificationUrl(appOrigin: string): string {
  const origin = appOrigin.trim().replace(/\/$/, "") || "http://localhost:3000";
  return `${origin}/api/subscriptions/mercadopago/public-checkout/ipn`;
}

/**
 * Mercado Pago Feed / IPN: `?topic=payment&id=123`.
 * O id só entra se for numérico. A confirmação do pagamento continua na API do MP.
 */
export function parseMercadoPagoPaymentIpn(
  topic: string | null,
  id: string | null
): MercadoPagoPaymentIpn | null {
  const normalizedTopic = topic?.trim().toLowerCase() ?? "";
  if (normalizedTopic !== "payment") return null;
  const paymentId = id?.trim() ?? "";
  if (!/^\d{6,20}$/.test(paymentId)) return null;
  return {
    id: paymentId,
    type: "payment",
    action: "payment.updated",
    data: { id: paymentId },
  };
}

export function isMercadoPagoRootPaymentIpn(input: {
  method: string;
  pathname: string;
  topic: string | null;
  id: string | null;
}): boolean {
  if (input.pathname !== "/") return false;
  if (input.method.toUpperCase() !== "POST") return false;
  return parseMercadoPagoPaymentIpn(input.topic, input.id) !== null;
}
