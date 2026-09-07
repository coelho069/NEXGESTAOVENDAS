import type { Enums } from "@/lib/db/types";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { evaluatePixCheckoutGate } from "@/lib/domain/stripe-pix";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function isCardPaymentHealthSelectable(input: {
  ok: boolean;
  status: number;
  contentType?: string | null;
  body: unknown;
}): boolean {
  if (!input.ok || input.status < 200 || input.status >= 300) {
    return false;
  }

  const contentType = input.contentType ?? "";
  if (!contentType.includes("application/json")) {
    return false;
  }
  if (!input.body || typeof input.body !== "object") {
    return false;
  }

  const body = input.body as {
    configured?: unknown;
    testmode?: unknown;
    status?: unknown;
  };
  if (body.configured !== true || body.testmode !== true) {
    return false;
  }
  if (body.status === "not_configured") {
    return false;
  }
  return true;
}

export const isPixPaymentHealthSelectable = isCardPaymentHealthSelectable;

export async function fetchPixPaymentSelectable(fetchFn: FetchLike = fetch): Promise<boolean> {
  try {
    const response = await fetchFn("/api/payments/pix", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const contentType = response.headers.get("content-type");
    let body: unknown = null;
    if ((contentType ?? "").includes("application/json")) {
      body = await response.json();
    }
    const healthOk = isPixPaymentHealthSelectable({
      ok: response.ok,
      status: response.status,
      contentType,
      body,
    });
    return evaluatePixCheckoutGate({
      flagEnabled: healthOk,
      healthConfigured: healthOk,
      healthTestmode: healthOk,
      online: typeof navigator === "undefined" || navigator.onLine !== false,
    }).selectable;
  } catch {
    return false;
  }
}

export async function fetchCardPaymentSelectable(fetchFn: FetchLike = fetch): Promise<boolean> {
  try {
    const response = await fetchFn("/api/payments/card", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const contentType = response.headers.get("content-type");
    let body: unknown = null;
    if ((contentType ?? "").includes("application/json")) {
      body = await response.json();
    }
    return isCardPaymentHealthSelectable({
      ok: response.ok,
      status: response.status,
      contentType,
      body,
    });
  } catch {
    return false;
  }
}

export async function isCheckoutPaymentSelectable(
  method: Enums<"payment_method">,
  fetchFn: FetchLike = fetch
): Promise<boolean> {
  switch (method) {
    case "cash":
      return getPaymentAdapter("cash").process("0.00").status === "configured";
    case "card":
      return fetchCardPaymentSelectable(fetchFn);
    case "pix":
      return fetchPixPaymentSelectable(fetchFn);
    case "voucher":
    case "other":
      return getPaymentAdapter(method).process("0.00").status === "configured";
    default: {
      const exhaustive: never = method;
      void exhaustive;
      return false;
    }
  }
}
