import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { fiscalIssueInputSchema } from "@/lib/validation/schemas";
import { fiscalRpcErrorResponse } from "@/lib/server/fiscal-api";
import { requestFiscalIssueAfterCommit } from "@/lib/server/fiscal-operation";

export async function POST(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }
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

  const parsed = fiscalIssueInputSchema.safeParse(json);
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

  const result = await requestFiscalIssueAfterCommit(supabase, {
    storeId: parsed.data.store_id,
    saleId: parsed.data.sale_id,
    operationId: parsed.data.operation_id,
  });
  if (result.error) return fiscalRpcErrorResponse(result.error);
  return NextResponse.json(result.data ?? {});
}
