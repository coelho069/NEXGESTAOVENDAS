import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { normalizeLoginEmail, requestClientIp } from "@/lib/security/login-limiter";
import { sendPasswordRecoveryEmail } from "@/lib/server/password-recovery-email";

const bodySchema = z.object({ email: z.string().trim().min(3).max(320) });
const HOUR_MS = 60 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const GENERIC = { ok: true, message: "Se o e-mail existir, enviaremos um link." };

/** Resposta sempre genérica (não revela se o e-mail existe). 3/h por e-mail, 10/h por IP. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(GENERIC, { headers: NO_STORE });
  }
  const email = normalizeLoginEmail(parsed.data.email);

  // Sem IP confiável não há bucket por IP (evita um balde compartilhado por todos); o limite por e-mail segue.
  const ip = requestClientIp(request);
  const byIp = ip
    ? consumeRateLimit({ key: `forgot:ip:${ip}`, limit: 10, windowMs: HOUR_MS })
    : { allowed: true as const };
  const byEmail = consumeRateLimit({ key: `forgot:email:${email}`, limit: 3, windowMs: HOUR_MS });
  if (!byIp.allowed || !byEmail.allowed) {
    const wait = Math.max(
      byIp.allowed ? 0 : byIp.retryAfterSec,
      byEmail.allowed ? 0 : byEmail.retryAfterSec
    );
    return NextResponse.json(
      { ok: false, message: "Muitas solicitações. Tente novamente mais tarde." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(wait) } }
    );
  }

  const origin = process.env.APP_ORIGIN?.trim() || new URL(request.url).origin;
  try {
    // Fluxo implícito: o link volta com tokens no hash, lidos por /redefinir-senha no navegador.
    await sendPasswordRecoveryEmail({
      email,
      redirectTo: `${new URL(origin).origin}/redefinir-senha`,
    });
  } catch {
    // resposta continua genérica
  }
  return NextResponse.json(GENERIC, { headers: NO_STORE });
}
