import type { User } from "@supabase/supabase-js";
import { visibleClientRefundPayments, type ClientRefundPaymentView } from "@/lib/domain/client-refund-eligibility";
import {
  normalizedVerifiedGmail,
  refundGmailAccess,
  type RefundGmailAccess,
} from "@/lib/domain/refund-gmail-access";
import { listOwnedRefundPayments } from "@/lib/server/client-refund-requests";
import { createAdminClient } from "@/lib/supabase/admin";

/** Acesso do usuário logado ao pedido de reembolso (exige Gmail verificado). `user` já lido pela página. */
export async function loadClientRefundAccess(user: User | null): Promise<RefundGmailAccess> {
  try {
    if (!user?.id) return "unauthenticated";
    return refundGmailAccess({
      email: user.email,
      emailConfirmedAt: user.email_confirmed_at,
    });
  } catch {
    return "unauthenticated";
  }
}

/**
 * Acesso + pagamentos do painel de reembolso em paralelo: o painel só lista
 * pagamentos quando o acesso é `allowed`, mas a checagem é local (sem I/O).
 */
export async function loadRefundPanel(
  user: User | null,
  orgId: string | null
): Promise<{ refundAccess: RefundGmailAccess; refundPayments: ClientRefundPaymentView[] }> {
  const [refundAccess, payments] = await Promise.all([
    loadClientRefundAccess(user),
    loadClientRefundPayments(user, orgId),
  ]);
  return { refundAccess, refundPayments: refundAccess === "allowed" ? payments : [] };
}

/** Pagamentos do próprio usuário que podem aparecer no painel de reembolso. */
export async function loadClientRefundPayments(
  user: User | null,
  orgId: string | null
): Promise<ClientRefundPaymentView[]> {
  try {
    const admin = createAdminClient();
    const email = normalizedVerifiedGmail(user?.email);
    const access = refundGmailAccess({
      email: user?.email,
      emailConfirmedAt: user?.email_confirmed_at,
    });
    if (!user?.id || !email || access !== "allowed" || !admin) return [];
    const payments = await listOwnedRefundPayments(admin, {
      userId: user.id,
      email,
      orgId,
    });
    return visibleClientRefundPayments(payments);
  } catch {
    return [];
  }
}
