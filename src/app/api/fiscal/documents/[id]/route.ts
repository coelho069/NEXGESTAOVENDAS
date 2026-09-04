import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canViewReports } from "@/lib/domain/rbac";
import { stripSecrets } from "@/lib/offline/secrets";

const documentIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const documentId = documentIdSchema.safeParse(id);
  if (!documentId.success) {
    return NextResponse.json({ error: "invalid_fiscal_document_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: document, error } = await supabase
    .from("fiscal_documents")
    .select(
      "id, org_id, store_id, sale_id, adapter, status, external_id, payload, operation_id, last_operation, attempt_count, last_error, requested_at, issued_at, cancelled_at, unknown_at, reconciled_at, created_at, updated_at"
    )
    .eq("id", documentId.data)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "fiscal_unavailable" }, { status: 503 });
  if (!document) return NextResponse.json({ error: "fiscal_not_found" }, { status: 404 });

  const auth = await getAuthedContext(document.store_id);
  if (!auth?.orgId || !auth.role || !canViewReports(auth.role)) {
    return NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ...document,
    payload: stripSecrets(document.payload ?? {}),
    last_error: document.last_error
      ? String(document.last_error).slice(0, 280)
      : document.last_error,
  });
}
