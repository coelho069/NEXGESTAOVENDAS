import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";
import { isMutatingMethod, isSameOriginRequest } from "@/lib/security/request";
import {
  applyCorrelationHeaders,
  readCorrelationId,
} from "@/lib/observability/correlation";

export async function middleware(request: NextRequest) {
  const correlationId = readCorrelationId(request.headers);
  const isHealthRoute = request.nextUrl.pathname.startsWith("/health/");
  if (isHealthRoute) {
    const response = NextResponse.next();
    applyCorrelationHeaders(response.headers, correlationId);
    return withSecurityHeaders(response);
  }

  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  if (isApiRoute && isMutatingMethod(request.method)) {
    const contentLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
      return withSecurityHeaders(
        NextResponse.json({ error: "request_too_large" }, { status: 413 }),
        correlationId
      );
    }
    if (!isSameOriginRequest(request)) {
      return withSecurityHeaders(
        NextResponse.json({ error: "csrf_failed" }, { status: 403 }),
        correlationId
      );
    }
  }

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
  const isProtected =
    request.nextUrl.pathname.startsWith("/pdv") ||
    request.nextUrl.pathname.startsWith("/inventory") ||
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/admin");
  const response = await updateSession(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const fixturesAllowed =
    process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_PDV_FIXTURES === "1";
  if (!url || !anonKey) {
    if (process.env.NODE_ENV === "production" && !fixturesAllowed && (isProtected || isApiRoute)) {
      return withSecurityHeaders(
        new NextResponse("Authentication is not configured.", { status: 503 }),
        correlationId
      );
    }
    return withSecurityHeaders(response, correlationId);
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // Session refresh cookie writes are owned by updateSession so Secure /
        // HttpOnly / SameSite are applied in one place.
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtected) {
    const publicOrigin = process.env.APP_ORIGIN?.trim() || request.nextUrl.origin;
    const redirect = new URL("/login", publicOrigin);
    return withSecurityHeaders(NextResponse.redirect(redirect), correlationId);
  }

  if (user && isAuthRoute) {
    const publicOrigin = process.env.APP_ORIGIN?.trim() || request.nextUrl.origin;
    const redirect = new URL("/pdv", publicOrigin);
    return withSecurityHeaders(NextResponse.redirect(redirect), correlationId);
  }

  return withSecurityHeaders(response, correlationId);
}

function withSecurityHeaders(
  response: NextResponse,
  correlationId?: string
): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  response.headers.set("X-DNS-Prefetch-Control", "off");
  if (correlationId) {
    applyCorrelationHeaders(response.headers, correlationId);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
