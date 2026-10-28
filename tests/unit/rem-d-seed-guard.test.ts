import { describe, expect, it } from "vitest";
import { assertSeedTargetAllowed } from "../../scripts/seed-auth-guard";

describe("seed-auth target guard", () => {
  it("permite Supabase local sem flag", () => {
    expect(() => assertSeedTargetAllowed("http://127.0.0.1:54321", {})).not.toThrow();
    expect(() => assertSeedTargetAllowed("http://localhost:54321", {})).not.toThrow();
  });

  it("recusa host remoto por padrão", () => {
    expect(() => assertSeedTargetAllowed("https://abcdefgh.supabase.co", {})).toThrow(/Refusing to seed remote/);
  });

  it("aceita host remoto só com ALLOW_REMOTE_SEED=1 exato", () => {
    const url = "https://abcdefgh.supabase.co";
    expect(() => assertSeedTargetAllowed(url, { ALLOW_REMOTE_SEED: "1" })).not.toThrow();
    expect(() => assertSeedTargetAllowed(url, { ALLOW_REMOTE_SEED: "true" })).toThrow();
    expect(() => assertSeedTargetAllowed(url, { ALLOW_REMOTE_SEED: "0" })).toThrow();
  });

  it("recusa URL inválida", () => {
    expect(() => assertSeedTargetAllowed("não-é-url", {})).toThrow(/Invalid Supabase URL/);
  });
});
