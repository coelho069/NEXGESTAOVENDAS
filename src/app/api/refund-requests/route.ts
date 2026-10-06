import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { normalizedVerifiedGmail, refundGmailAccess } from "@/lib/domain/refund-gmail-access";
import { createRequestObservability, observeApiResult } from "@/lib/observability/request-context";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { refundRequestBrowserAllowed } from "@/lib/security/refund-request-origin";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createClientRefundReader,
  createOwnedRefundRequest,
  ownedRefundStore,
} from "@/lib/server/client-refund-requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createOwnedRefundRequestSchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "refund-requests.create");

  if (!refundRequestBrowserAllowed(request)) {
    observeApiResult(obs, "rejected", { error: "csrf_failed" });
    return obs.withHeaders(NextResponse.json({ error: "csrf_failed" }, { status: 403 }));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    observeApiResult(obs, "rejected", { error: "unauthenticated" });
    return obs.withHeaders(NextResponse.json({ error: "unauthenticated" }, { status: 401 }));
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, `refund-requests-create:${user.id}`),
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.allowed) return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));

  const gmail = normalizedVerifiedGmail(user.email);
  if (
    refundGmailAccess({
      email: user.email,
      emailConfirmedAt: user.email_confirmed_at,
    }) !== "allowed" ||
    !gmail
  ) {
    observeApiResult(obs, "rejected", { error: "gmail_verified_required" });
    return obs.withHeaders(NextResponse.json({ error: "gmail_verified_required" }, { status: 403 }));
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return obs.withHeaders(NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }));
  }

  const parsed = createOwnedRefundRequestSchema.safeParse(json);
  if (!parsed.success) {
    return obs.withHeaders(
      validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten())
    );
  }

  const context = await getAuthedContext();
  const admin = createAdminClient();
  if (!admin) {
    observeApiResult(obs, "server_error", { error: "service_role_unavailable" });
    return obs.withHeaders(NextResponse.json({ error: "service_role_unavailable" }, { status: 503 }));
  }

  try {
    const reader = createClientRefundReader(admin);
    const checkout = await reader.findCheckoutByPaymentId(parsed.data.mp_payment_id);
    const hasOpenRequest = checkout ? await reader.hasOpenRequest(parsed.data.mp_payment_id) : false;
    const result = await createOwnedRefundRequest(ownedRefundStore(admin), {
      actor: {
        userId: user.id,
        email: gmail,
        orgId: context?.orgId ?? null,
      },
      checkout: checkout
        ? {
            id: checkout.id,
            payerEmail: checkout.payer_email,
            mpPaymentId: checkout.mp_payment_id,
            mpPaymentStatus: checkout.mp_payment_status,
            mpPaymentPaidAt: checkout.mp_payment_paid_at,
            onboardingUserId: checkout.onboarding_user_id,
            onboardingOrganizationId: checkout.onboarding_organization_id,
          }
        : null,
      hasOpenRequest,
      clientMutationId: parsed.data.client_mutation_id,
      mpPaymentId: parsed.data.mp_payment_id,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
      intensiveUseDeclared: false,
    });
    if (!result.ok) {
      observeApiResult(obs, result.status >= 500 ? "server_error" : "rejected", { error: result.error });
      return obs.withHeaders(NextResponse.json({ error: result.error }, { status: result.status }));
    }
    observeApiResult(obs, "ok", { replayed: result.replayed });
    return obs.withHeaders(
      NextResponse.json(
        { ok: true, id: result.id, status: result.status, replayed: result.replayed },
        { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } }
      )
    );
  } catch {
    observeApiResult(obs, "server_error", { error: "unavailable" });
    return obs.withHeaders(NextResponse.json({ error: "unavailable" }, { status: 503 }));
  }
}
