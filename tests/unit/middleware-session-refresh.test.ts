import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient,
}));

import { middleware } from "@/middleware";
import { updateSession } from "@/lib/supabase/middleware";
import {
  applySessionCookieOptions,
  copySetCookieHeaders,
  isInvalidRefreshTokenError,
  isSupabaseAuthCookieName,
} from "@/lib/supabase/session-cookies";

const AUTH_COOKIE = "sb-proj-auth-token";
const AUTH_COOKIE_CHUNK = "sb-proj-auth-token.0";
const OTHER_COOKIE = "theme";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class FakeAuthApiError extends Error {
  code = "refresh_token_not_found";
  status = 400;
  constructor(message = "Invalid Refresh Token: Refresh Token Not Found") {
    super(message);
    this.name = "AuthApiError";
  }
}

function requestWithCookies(path: string, cookies: Record<string, string> = {}) {
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: header ? { cookie: header } : undefined,
  });
}

function setSupabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-with-enough-length";
}

function mockGetUser(
  impl: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>
) {
  createServerClient.mockImplementation(() => ({
    auth: {
      getUser: vi.fn(impl),
    },
  }));
}

function setCookies(response: NextResponse): string[] {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

describe("supabase auth cookie helpers", () => {
  it("detects chunked and verifier auth cookies without touching other cookies", () => {
    expect(isSupabaseAuthCookieName(AUTH_COOKIE)).toBe(true);
    expect(isSupabaseAuthCookieName(AUTH_COOKIE_CHUNK)).toBe(true);
    expect(isSupabaseAuthCookieName("sb-proj-auth-token-code-verifier")).toBe(true);
    expect(isSupabaseAuthCookieName(OTHER_COOKIE)).toBe(false);
  });

  it("recognizes invalid refresh token errors from AuthApiError shape", () => {
    expect(isInvalidRefreshTokenError(new FakeAuthApiError())).toBe(true);
    expect(
      isInvalidRefreshTokenError({
        name: "AuthApiError",
        status: 400,
        code: "session_expired",
        message: "Session expired",
      })
    ).toBe(true);
    expect(isInvalidRefreshTokenError(new Error("network down"))).toBe(false);
    expect(isInvalidRefreshTokenError(null)).toBe(false);
    expect(
      isInvalidRefreshTokenError({ code: "refresh_token_already_used", message: "Already used" })
    ).toBe(true);
  });

  it("keeps Secure/HttpOnly/SameSite aligned with production cookie policy", () => {
    const previous = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    expect(applySessionCookieOptions({ maxAge: 0 })).toEqual({
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    vi.stubEnv("NODE_ENV", previous);
  });

  it("copies Set-Cookie headers onto a replacement response", () => {
    const from = NextResponse.next();
    from.cookies.set(AUTH_COOKIE, "", applySessionCookieOptions({ maxAge: 0 }));
    const to = NextResponse.redirect("http://localhost:3000/login");
    copySetCookieHeaders(from, to);
    const cookies = setCookies(to).join("\n");
    expect(cookies).toContain(AUTH_COOKIE);
    expect(cookies.toLowerCase()).toContain("httponly");
  });
});

describe("updateSession invalid refresh tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSupabaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not throw when getUser rejects with refresh_token_not_found", async () => {
    mockGetUser(async () => {
      throw new FakeAuthApiError();
    });

    const request = requestWithCookies("/login", {
      [AUTH_COOKIE]: "stale",
      [OTHER_COOKIE]: "dark",
    });

    const session = updateSession(request);
    await expect(session).resolves.toMatchObject({ user: null });
    const { response, user } = await session;
    expect(user).toBeNull();
    const cookies = setCookies(response);
    expect(cookies.some((cookie) => cookie.startsWith(`${AUTH_COOKIE}=`))).toBe(true);
    expect(cookies.join("\n").toLowerCase()).toContain("max-age=0");
    expect(cookies.join("\n")).not.toContain(`${OTHER_COOKIE}=`);
  });

  it("treats a returned refresh_token_not_found error as signed-out and expires cookies", async () => {
    mockGetUser(async () => ({
      data: { user: null },
      error: new FakeAuthApiError(),
    }));

    const { response, user } = await updateSession(
      requestWithCookies("/pdv", { [AUTH_COOKIE_CHUNK]: "stale-chunk" })
    );

    expect(user).toBeNull();
    const cookies = setCookies(response).join("\n");
    expect(cookies).toContain(AUTH_COOKIE_CHUNK);
    expect(cookies.toLowerCase()).toContain("max-age=0");
    expect(cookies.toLowerCase()).toContain("httponly");
    expect(cookies.toLowerCase()).toContain("samesite=lax");
  });

  it("keeps a valid session user and does not expire auth cookies", async () => {
    mockGetUser(async () => ({
      data: { user: { id: USER_ID } },
      error: null,
    }));

    const { response, user } = await updateSession(
      requestWithCookies("/pdv", { [AUTH_COOKIE]: "valid" })
    );

    expect(user).toEqual({ id: USER_ID });
    expect(setCookies(response).some((cookie) => cookie.includes("Max-Age=0"))).toBe(false);
  });

  it("does not expire cookies when getUser fails with a non-auth error", async () => {
    mockGetUser(async () => {
      throw new Error("fetch failed");
    });

    const { response, user } = await updateSession(
      requestWithCookies("/login", { [AUTH_COOKIE]: "stale" })
    );

    expect(user).toBeNull();
    expect(setCookies(response).join("\n")).not.toContain(AUTH_COOKIE);
  });

  it("returns next without calling supabase when env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { response, user } = await updateSession(requestWithCookies("/login"));
    expect(user).toBeNull();
    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("middleware session refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSupabaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns next for /login when the refresh token is invalid", async () => {
    mockGetUser(async () => {
      throw new FakeAuthApiError();
    });

    const response = await middleware(
      requestWithCookies("/login", { [AUTH_COOKIE]: "stale" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(setCookies(response).join("\n").toLowerCase()).toContain("max-age=0");
  });

  it("redirects protected routes to /login and forwards expired auth cookies", async () => {
    mockGetUser(async () => {
      throw new FakeAuthApiError();
    });

    const response = await middleware(
      requestWithCookies("/pdv", { [AUTH_COOKIE]: "stale" })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(setCookies(response).join("\n")).toContain(AUTH_COOKIE);
    expect(setCookies(response).join("\n").toLowerCase()).toContain("max-age=0");
  });

  it("does not block a valid session on admin routes", async () => {
    mockGetUser(async () => ({
      data: { user: { id: USER_ID } },
      error: null,
    }));

    const response = await middleware(requestWithCookies("/admin/subscriptions"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects an authenticated user away from /login", async () => {
    mockGetUser(async () => ({
      data: { user: { id: USER_ID } },
      error: null,
    }));

    const response = await middleware(requestWithCookies("/login"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/pdv");
  });
});
