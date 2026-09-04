import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageFiscal } from "@/lib/domain/rbac";
import {
  fiscalCancelInputSchema,
} from "@/lib/validation/schemas";
import { fiscalRpcErrorResponse } from "@/lib/server/fiscal-api";
import { settleFiscalOutbox } from "@/lib/server/fiscal-operation";
import { getFiscalProviderConfig } from "@/lib/server/fiscal-provider";
import { validationFailedResponse } from "@/lib/security/safe-error";

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

  const parsed = fiscalCancelInputSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role || !canManageFiscal(auth.role)) {
    return NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 });
  }

  const provider = getFiscalProviderConfig();
  const { data, error } = await supabase.rpc("request_fiscal_cancel", {
    p_payload: {
      ...parsed.data,
      provider: provider.configured ? provider.provider : "not_configured",
    },
  });
  if (error) return fiscalRpcErrorResponse(error);

  if (provider.configured && data && typeof data === "object" && !Array.isArray(data)) {
    const settled = await settleFiscalOutbox(supabase, data);
    if (settled.error) return fiscalRpcErrorResponse(settled.error);
    return NextResponse.json(settled.data);
  }

  return NextResponse.json(data ?? {});
}
