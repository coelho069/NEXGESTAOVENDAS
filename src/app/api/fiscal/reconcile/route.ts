import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { fiscalReconcileInputSchema } from "@/lib/validation/schemas";
import { fiscalRpcErrorResponse } from "@/lib/server/fiscal-api";
import { settleFiscalOutbox } from "@/lib/server/fiscal-operation";
import { getFiscalProviderConfig } from "@/lib/server/fiscal-provider";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = fiscalReconcileInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 });
  }

  const provider = getFiscalProviderConfig();
  if (!provider.configured) {
    return NextResponse.json({
      ...parsed.data,
      status: "not_configured",
      provider: "not_configured",
      reconciled: false,
    });
  }

  const { data, error } = await supabase.rpc("request_fiscal_reconcile", {
    p_payload: parsed.data,
  });
  if (error) return fiscalRpcErrorResponse(error);

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const settled = await settleFiscalOutbox(supabase, data);
    if (settled.error) return fiscalRpcErrorResponse(settled.error);
    return NextResponse.json(settled.data);
  }

  return NextResponse.json(data ?? {});
}
