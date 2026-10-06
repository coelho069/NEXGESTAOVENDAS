import { isSameOriginRequest } from "@/lib/security/request";

/**
 * Browser gate for the authenticated refund-request endpoint.
 * A missing Origin is rejected here. Workers are not callers of this route.
 */
export function refundRequestBrowserAllowed(request: Pick<Request, "url" | "headers">): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return false;
  }

  return isSameOriginRequest(request);
}
