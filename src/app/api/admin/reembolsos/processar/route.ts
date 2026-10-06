import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getPlatformAdminAccess } from "@/lib/auth/admin";
import { refundSandboxProcessingEnabled } from "@/lib/domain/refund-sandbox-mode";
import { refundRequestBrowserAllowed } from "@/lib/security/refund-request-origin";
import { processAdminSandboxRefund } from "@/lib/server/admin-sandbox-refund-processing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { adminSandboxRefundProcessSchema } from "@/lib/validation/schemas";

/**
 * Local admin sandbox refund processing.
 * Fails closed unless the sandbox flag, a non-production Node environment,
 * and a loopback Supabase endpoint all agree. The browser cannot choose the mock scenario.
 * Does not call Mercado Pago, Stripe, or any other payment HTTP API.
 */
export async function POST(request: Request) {
  if (!refundRequestBrowserAllowed(request)) {
    return NextResponse.json({ error: "csrf_failed", financial_effect: false }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthenticated", financial_effect: false }, { status: 401 });
  }

  const access = await getPlatformAdminAccess();
  if (!access) {
    return NextResponse.json({ error: "forbidden", financial_effect: false }, { status: 403 });
  }

  if (!refundSandboxProcessingEnabled(process.env)) {
    return NextResponse.json({ error: "sandbox_disabled", financial_effect: false }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "validation_failed", financial_effect: false }, { status: 400 });
  }

  const parsed = adminSandboxRefundProcessSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", financial_effect: false }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "service_role_unavailable", financial_effect: false }, { status: 503 });
  }

  try {
    const outcome = await processAdminSandboxRefund({
      admin,
      refundRequestId: parsed.data.id,
      scenario: "success",
      retry: parsed.data.retry,
    });
    if (outcome.httpStatus === 200) {
      revalidatePath("/admin/reembolsos");
    }
    return NextResponse.json(outcome.body, {
      status: outcome.httpStatus,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "unavailable", financial_effect: false }, { status: 503 });
  }
}
