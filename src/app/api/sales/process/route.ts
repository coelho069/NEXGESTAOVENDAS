import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processSaleInputSchema } from "@/lib/validation/schemas";
import type { ProcessSaleResult } from "@/lib/db/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = processSaleInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const hasNonCash = parsed.data.payments.some((payment) => payment.method !== "cash");
  if (hasNonCash) {
    return NextResponse.json(
      { error: "payment_method_not_configured", adapter_status: "not_configured" },
      { status: 422 }
    );
  }

  const { data, error } = await supabase.rpc("process_sale", {
    p_payload: parsed.data,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json(data as ProcessSaleResult);
}
