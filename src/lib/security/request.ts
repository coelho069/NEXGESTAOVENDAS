const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

function collectAllowedOrigins(requestUrl: string): Set<string> | null {
  const allowedOrigins = new Set<string>();
  try {
    allowedOrigins.add(new URL(requestUrl).origin);
  } catch {
    return null;
  }

  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      allowedOrigins.add(new URL(configuredOrigin).origin);
    } catch {
      return null;
    }
  }

  return allowedOrigins;
}

/**
 * Cookie-authenticated browser requests must stay same-origin. Non-browser
 * callers such as the fiscal worker may omit Origin; they are authenticated
 * independently by their endpoint-specific secret.
 *
 * Production requires APP_ORIGIN so reverse-proxy host mismatches cannot open
 * an Origin allowlist hole.
 */
export function isSameOriginRequest(request: Pick<Request, "url" | "headers">): boolean {
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.APP_ORIGIN?.trim()
  ) {
    return false;
  }

  const origin = request.headers.get("origin");
  const allowedOrigins = collectAllowedOrigins(request.url);
  if (!allowedOrigins) return false;

  if (origin) {
    if (origin === "null") return false;
    if (!allowedOrigins.has(origin)) return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  // Cookie session mutations from browsers that send Sec-Fetch-Site must be
  // same-origin/same-site. Workers omit the header and authenticate separately.
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return false;
  }

  return true;
}
