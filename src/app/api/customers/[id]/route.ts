import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { customerPatchSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canEditCustomers } from "@/lib/domain/rbac";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = customerPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "empty_patch" }, { status: 400 });
  }

  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.orgId || !auth.role || !canEditCustomers(auth.role)) {
    return NextResponse.json({ error: "forbidden_customers" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("customers")
    .update({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.document !== undefined ? { document: parsed.data.document } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
      ...("age" in parsed.data ? { age: parsed.data.age ?? null } : {}),
    })
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "customer_write_failed", detail: error.message }, { status: 422 });
  }

  return NextResponse.json(data);
}
