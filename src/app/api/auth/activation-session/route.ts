import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ACTIVATION_LINK_COOKIE, canDefineActivationPassword } from "@/lib/domain/activation-link";
import { isClientAccountStatus } from "@/lib/domain/admin-client-accounts";
import type { Database } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  accessToken: z.string().trim().min(20).max(8192),
  refreshToken: z.string().trim().min(8).max(4096),
});

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

/**
 * Persists the invite/recovery session from the URL as HttpOnly cookies.
 * The browser client cannot replace an administrator cookie that the
 * middleware already marked HttpOnly, so the password form used to run
 * against the wrong session — or against none.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const pending: CookieToSet[] = [];
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        pending.splice(0, pending.length, ...cookiesToSet);
      },
    },
  });

  const { data, error } = await supabase.auth.setSession({
    access_token: parsed.data.accessToken,
    refresh_token: parsed.data.refreshToken,
  });
  if (error || !data.user?.id) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  const account = await admin
    .from("client_accounts")
    .select("status")
    .eq("user_id", data.user.id)
    .maybeSingle();
  const status = account.data?.status;
  if (account.error || !isClientAccountStatus(status) || !canDefineActivationPassword(status, true)) {
    return NextResponse.json(
      { ok: false, error: account.error || !isClientAccountStatus(status) ? "account_not_found" : "forbidden" },
      { status: 403 }
    );
  }

  const response = NextResponse.json({ ok: true, status });
  response.cookies.set(ACTIVATION_LINK_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
  });
  for (const cookie of pending) {
    response.cookies.set(cookie.name, cookie.value, {
      ...cookie.options,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" ? true : cookie.options?.secure,
      sameSite: cookie.options?.sameSite ?? "lax",
      path: cookie.options?.path ?? "/",
    });
  }
  return response;
}
