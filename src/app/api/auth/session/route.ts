import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, org_id")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({ authenticated: true, user: { id: user.id, email: user.email }, profile });
}
