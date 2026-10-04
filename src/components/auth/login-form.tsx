"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/landing/components/BrandMark";
import { Reveal } from "@/components/landing/components/Reveal";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

const CSS = `
.nx-login-input {
  width: 100%;
  border-radius: ${t.radius.md};
  border: 1px solid ${t.color.borderStrong};
  background: rgba(15, 23, 42, 0.55);
  color: ${t.color.text};
  padding: 12px 14px;
  font-size: 15px;
  font-family: ${t.font.body};
  outline: none;
  transition: border-color ${t.motion.fast} ease, box-shadow ${t.motion.fast} ease, background ${t.motion.fast} ease;
}
.nx-login-input::placeholder { color: ${t.color.textMuted}; opacity: 0.85; }
.nx-login-input:focus-visible {
  border-color: rgba(37, 99, 235, 0.55);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
  background: rgba(15, 23, 42, 0.72);
}
.nx-login-submit {
  width: 100%;
  border: none;
  border-radius: ${t.radius.md};
  padding: 13px 18px;
  font-size: 15px;
  font-weight: 600;
  font-family: ${t.font.body};
  color: #FFFFFF;
  cursor: pointer;
  background: linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%);
  box-shadow: ${t.shadow.ctaGlow};
  transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease, opacity ${t.motion.fast} ease;
}
.nx-login-submit:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
  filter: grayscale(0.2);
}
@media (hover: hover) {
  .nx-login-submit:not(:disabled):hover {
    box-shadow: ${t.shadow.ctaAccentGlow};
    transform: translateY(-1px);
    filter: brightness(1.05);
  }
}
.nx-login-back {
  color: ${t.color.textMuted};
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  transition: color ${t.motion.fast} ease;
}
.nx-login-back:hover, .nx-login-back:focus-visible {
  color: ${t.color.text};
  outline: none;
}
@media (prefers-reduced-motion: reduce) {
  .nx-login-input, .nx-login-submit, .nx-login-back { transition: none; }
  .nx-login-submit:not(:disabled):hover { transform: none; }
}
`;

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (signInError) {
      setError("Credenciais inválidas ou sessão indisponível.");
      return;
    }

    router.replace("/pdv");
    router.refresh();
  };

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(20px, 5vw, 40px)",
        background: t.color.bg,
        color: t.color.text,
        fontFamily: t.font.body,
        WebkitFontSmoothing: "antialiased",
        overflowX: "hidden",
      }}
    >
      <style>{CSS}</style>

      {/* Glows de fundo — mesmo gesto visual da landing */}
      <div
        aria-hidden="true"
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(900px 480px at 50% -80px, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(16, 185, 129, 0.08) 0%, transparent 65%)",
        }}
      />

      <main
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 440,
        }}
      >
        <Reveal>
          <form
            onSubmit={onSubmit}
            style={{
              width: "100%",
              padding: "clamp(28px, 5vw, 36px)",
              borderRadius: t.radius.xl,
              border: `1px solid ${t.color.glassBorder}`,
              background: t.color.glassBg,
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: `${t.shadow.card}, 0 0 0 1px rgba(255, 255, 255, 0.03) inset`,
            }}
          >
            <div style={{ marginBottom: 28, textAlign: "center" }}>
              <Link
                href="/"
                aria-label="NexGestão — voltar ao início"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  textDecoration: "none",
                  marginBottom: 20,
                }}
              >
                <BrandMark size={32} gradientId="nx-login-brand-grad" />
                <span
                  style={{
                    color: t.color.text,
                    fontFamily: t.font.heading,
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                  }}
                >
                  NexGestão
                </span>
              </Link>

              <h1
                style={{
                  margin: "0 0 8px",
                  fontFamily: t.font.heading,
                  fontSize: "clamp(22px, 4vw, 26px)",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: t.color.text,
                }}
              >
                Entrar no PDV
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: t.color.textMuted,
                }}
              >
                Use as credenciais fornecidas pelo administrador.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <label style={{ display: "block", fontSize: 14 }}>
                <span
                  style={{
                    display: "block",
                    marginBottom: 8,
                    fontWeight: 600,
                    color: t.color.textBody,
                  }}
                >
                  E-mail
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="nx-login-input"
                  placeholder="seu@email.com"
                />
              </label>

              <label style={{ display: "block", fontSize: 14 }}>
                <span
                  style={{
                    display: "block",
                    marginBottom: 8,
                    fontWeight: 600,
                    color: t.color.textBody,
                  }}
                >
                  Senha
                </span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="nx-login-input"
                  placeholder="••••••••"
                />
              </label>

              {error ? (
                <p
                  role="alert"
                  style={{
                    margin: 0,
                    padding: "10px 12px",
                    borderRadius: t.radius.md,
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    background: "rgba(239, 68, 68, 0.1)",
                    color: "#FCA5A5",
                    fontSize: 13.5,
                    lineHeight: 1.45,
                  }}
                >
                  {error}
                </p>
              ) : null}

              <button type="submit" disabled={loading} className="nx-login-submit">
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </div>

            <div
              style={{
                marginTop: 24,
                paddingTop: 20,
                borderTop: `1px solid ${t.color.border}`,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px 16px",
              }}
            >
              <Link href="/" className="nx-login-back">
                Voltar ao início
              </Link>
              <span aria-hidden="true" style={{ color: t.color.borderStrong }}>·</span>
              <Link href="/planos" className="nx-login-back">
                Ver planos
              </Link>
            </div>
          </form>
        </Reveal>
      </main>
    </div>
  );
}
