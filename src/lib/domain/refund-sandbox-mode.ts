/**
 * Local sandbox refund processing is opt-in and fail-closed.
 * The in-memory provider stays off unless the flag, the Node environment,
 * and every configured database endpoint are loopback. Production never
 * enables it. A missing or remote endpoint stays off.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const DATABASE_ENDPOINT_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
] as const;

export type RefundSandboxEndpointVerdict = "local" | "remote" | "absent";

function endpointVerdict(raw: string | undefined): RefundSandboxEndpointVerdict {
  const value = (raw ?? "").trim();
  if (!value) return "absent";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "remote";
  }
  const protocol = url.protocol;
  const allowedProtocol =
    protocol === "http:" || protocol === "https:" || protocol === "postgres:" || protocol === "postgresql:";
  if (!allowedProtocol) return "remote";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "supabase.co" || host.endsWith(".supabase.co")) return "remote";
  if (!LOOPBACK_HOSTS.has(host)) return "remote";
  return "local";
}

/** True only when the admin client would talk to a loopback database. */
export function refundSandboxDatabaseIsLocal(env: Record<string, string | undefined>): boolean {
  const primary = endpointVerdict(env.NEXT_PUBLIC_SUPABASE_URL);
  if (primary !== "local") return false;
  for (const name of DATABASE_ENDPOINT_NAMES) {
    if (name === "NEXT_PUBLIC_SUPABASE_URL") continue;
    const verdict = endpointVerdict(env[name]);
    if (verdict === "remote") return false;
  }
  return true;
}

export function refundSandboxProcessingEnabled(env: Record<string, string | undefined>): boolean {
  if ((env.NODE_ENV ?? "").trim() === "production") return false;
  if ((env.REFUND_SANDBOX_PROCESSING ?? "").trim() !== "local") return false;
  return refundSandboxDatabaseIsLocal(env);
}
