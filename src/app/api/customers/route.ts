import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageCustomers } from "@/lib/domain/rbac";
import {
  customerSearchQuerySchema,
  customerWriteSchema,
} from "@/lib/validation/schemas";
import { validateCustomerFields } from "@/lib/domain/customer";
import { loadStoreCommercialFlags } from "@/lib/server/store-settings";

function readError(error: { message?: string; code?: string }, fallback: string) {
  const message = error.message ?? "";
  if (message.includes("forbidden_customers")) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }
  if (message.includes("customer_document_conflict") || error.code === "23505") {
    return NextResponse.json({ error: "customer_document_conflict" }, { status: 409 });
  }
  if (message.includes("customer_not_found")) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }
  if (message.includes("customer_document_required")) {
    return NextResponse.json(
      { error: "customer_document_required", message: "Documento obrigatório pelas configurações da loja" },
      { status: 422 }
    );
  }
  if (
    message.includes("invalid_customer") ||
    message.includes("invalid_customer_name") ||
    message.includes("invalid_customer_document") ||
    message.includes("invalid_customer_email") ||
    message.includes("invalid_customer_phone")
  ) {
    return NextResponse.json({ error: "customer_validation_failed", message }, { status: 422 });
  }
  return NextResponse.json({ error: fallback }, { status: 503 });
}

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const parsed = customerSearchQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id"),
    query: url.searchParams.get("query") ?? "",
    limit: url.searchParams.get("limit") ?? undefined,
    after_name: url.searchParams.get("after_name") ?? undefined,
    after_id: url.searchParams.get("after_id") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role || !canManageCustomers(auth.role)) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("search_customers", {
    p_payload: {
      store_id: parsed.data.store_id,
      query: parsed.data.query,
      limit: parsed.data.limit,
      after_name: parsed.data.after_name,
      after_id: parsed.data.after_id,
    },
  });
  if (error) return readError(error, "customer_search_unavailable");
  return NextResponse.json(data);
}

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = customerWriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role || !canManageCustomers(auth.role)) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const loaded = await loadStoreCommercialFlags(supabase, parsed.data.store_id);
  if (!loaded.ok) {
    return NextResponse.json(
      { error: "settings_unavailable", message: loaded.message },
      { status: 503 }
    );
  }
  const flags = loaded.flags;
  const domain = validateCustomerFields({
    ...parsed.data,
    requireDocument: flags.require_customer_document,
  });
  if (!domain.ok) {
    const code = flags.require_customer_document && /documento/i.test(domain.error)
      ? "customer_document_required"
      : "customer_validation_failed";
    return NextResponse.json({ error: code, message: domain.error }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("upsert_customer", {
    p_payload: {
      store_id: parsed.data.store_id,
      customer_id: parsed.data.customer_id,
      name: domain.value.name,
      document: domain.value.document,
      email: domain.value.email,
      phone: domain.value.phone,
    },
  });
  if (error) return readError(error, "customer_write_unavailable");
  return NextResponse.json(data, { status: parsed.data.customer_id ? 200 : 201 });
}
