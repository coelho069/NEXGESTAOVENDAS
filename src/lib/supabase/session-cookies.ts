import { NextResponse, type NextRequest } from "next/server";

export type SessionCookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};

export function applySessionCookieOptions<T extends SessionCookieOptions | undefined>(
  options?: T
): SessionCookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" ? true : options?.secure,
    sameSite: options?.sameSite ?? "lax",
    path: options?.path ?? "/",
  };
}

export function isSupabaseAuthCookieName(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

export function collectSupabaseAuthCookieNames(
  cookies: Array<{ name: string }>
): string[] {
  return cookies.map((cookie) => cookie.name).filter(isSupabaseAuthCookieName);
}

export function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const status = typeof candidate.status === "number" ? candidate.status : undefined;

  if (
    code.includes("refresh_token") ||
    code === "session_expired" ||
    code === "session_not_found"
  ) {
    return true;
  }
  if (message.includes("refresh token")) return true;
  if (name === "AuthApiError" && status === 400) return true;
  if (name === "AuthApiError" && (code.includes("session") || message.includes("session"))) {
    return true;
  }
  return false;
}

export function expireSupabaseAuthCookies(
  request: NextRequest,
  response: NextResponse,
  cookieNames: string[]
): NextResponse {
  if (cookieNames.length === 0) return response;

  for (const name of cookieNames) {
    request.cookies.delete(name);
  }

  const nextResponse = NextResponse.next({ request });
  for (const name of cookieNames) {
    nextResponse.cookies.set(name, "", applySessionCookieOptions({ maxAge: 0 }));
  }
  return nextResponse;
}

export function copySetCookieHeaders(from: NextResponse, to: NextResponse): void {
  const cookies =
    typeof from.headers.getSetCookie === "function" ? from.headers.getSetCookie() : [];
  for (const cookie of cookies) {
    to.headers.append("Set-Cookie", cookie);
  }
}
