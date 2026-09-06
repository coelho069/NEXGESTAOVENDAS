import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageCustomers } from "@/lib/domain/rbac";
import {
  customerDetailQuerySchema,
  customerWriteSchema,
} from "@/lib/validation/schemas";
import { validateCustomerFields } from "@/lib/domain/customer";
import { loadStoreCommercialFlags } from "@/lib/server/store-settings";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
  if (message.includes("invalid_customer")) {
    return NextResponse.json({ error: "customer_validation_failed", message }, { status: 422 });
  }
  return NextResponse.json({ error: fallback }, { status: 503 });
}

export async function GET(request: Request, context: RouteContext) {
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

  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = customerDetailQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id"),
    customer_id: id,
    limit: url.searchParams.get("limit") ?? undefined,
    after_created_at: url.searchParams.get("after_created_at") ?? undefined,
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

  const { data, error } = await supabase.rpc("get_customer_detail", {
    p_payload: {
      store_id: parsed.data.store_id,
      customer_id: parsed.data.customer_id,
      limit: parsed.data.limit,
      after_created_at: parsed.data.after_created_at,
      after_id: parsed.data.after_id,
    },
  });
  if (error) return readError(error, "customer_detail_unavailable");
  return NextResponse.json(data);
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const withId =
    body && typeof body === "object"
      ? { ...(body as Record<string, unknown>), customer_id: id }
      : body;
  const parsed = customerWriteSchema.safeParse(withId);
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
      customer_id: id,
      name: domain.value.name,
      document: domain.value.document,
      email: domain.value.email,
      phone: domain.value.phone,
    },
  });
  if (error) return readError(error, "customer_write_unavailable");
  return NextResponse.json(data);
}
