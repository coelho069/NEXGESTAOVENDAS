/**
 * Guarda do seed de usuários demo: só aceita Supabase local por padrão.
 * Um alvo remoto exige ALLOW_REMOTE_SEED=1 explícito no ambiente do operador.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertSeedTargetAllowed(url: string, env: Record<string, string | undefined>): void {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("Invalid Supabase URL for seed target");
  }
  if (LOCAL_HOSTS.has(host)) return;
  if (env.ALLOW_REMOTE_SEED !== "1") {
    throw new Error(
      `Refusing to seed remote Supabase host "${host}". Set ALLOW_REMOTE_SEED=1 only for a non-production target you own.`,
    );
  }
}
