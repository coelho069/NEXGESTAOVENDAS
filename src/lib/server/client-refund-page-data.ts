import { visibleClientRefundPayments, type ClientRefundPaymentView } from "@/lib/domain/client-refund-eligibility";
import {
  normalizedVerifiedGmail,
  refundGmailAccess,
  type RefundGmailAccess,
} from "@/lib/domain/refund-gmail-access";
import { listOwnedRefundPayments } from "@/lib/server/client-refund-requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Acesso do usuário logado ao pedido de reembolso (exige Gmail verificado). */
export async function loadClientRefundAccess(): Promise<RefundGmailAccess> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return "unauthenticated";
    return refundGmailAccess({
      email: user.email,
      emailConfirmedAt: user.email_confirmed_at,
    });
  } catch {
    return "unauthenticated";
  }
}

/** Pagamentos do próprio usuário que podem aparecer no painel de reembolso. */
export async function loadClientRefundPayments(orgId: string | null): Promise<ClientRefundPaymentView[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
