import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import {
  blockedMessage,
  clearLoginFailures,
  loginBlockedSeconds,
  normalizeLoginEmail,
  loginLimiterKeys,
  recordLoginFailure,
} from "@/lib/security/login-limiter";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(1024),
});

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

const NO_STORE = { "Cache-Control": "no-store" };
const GENERIC_ERROR = "Credenciais inválidas ou sessão indisponível.";

/**
 * Login no servidor com limite de 5 falhas / 10 min por e-mail e por IP.
 * Define os cookies de sessão HttpOnly (como o middleware) e devolve os tokens
 * para o navegador adotar a sessão (mesmo padrão de /api/auth/activation-session),
 * mantendo useAuth/onAuthStateChange funcionando.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: GENERIC_ERROR }, { status: 400, headers: NO_STORE });
  }

  const email = normalizeLoginEmail(parsed.data.email);
  const keys = loginLimiterKeys(email, request);

  const wait = loginBlockedSeconds(keys);
  if (wait > 0) {
    return NextResponse.json(
      { ok: false, error: blockedMessage(wait) },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(wait) } }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, error: GENERIC_ERROR }, { status: 503, headers: NO_STORE });
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

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (error || !data.session) {
    // Falha de credencial conta; indisponibilidade do Auth (5xx) não.
    const status = (error as { status?: number } | null)?.status ?? 400;
    if (status < 500) recordLoginFailure(keys);
    return NextResponse.json(
      { ok: false, error: GENERIC_ERROR },
      { status: status >= 500 ? 503 : 401, headers: NO_STORE }
    );
  }

  clearLoginFailures([keys[0]]);

  const response = NextResponse.json(
    {
      ok: true,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
    },
    { headers: NO_STORE }
  );
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
