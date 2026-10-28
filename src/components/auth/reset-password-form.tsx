"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readActivationCallback } from "@/lib/domain/activation-link";
import { passwordResetErrorMessage } from "@/lib/domain/password-reset-errors";
import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  ACCOUNT_PASSWORD_REQUIREMENTS,
  describePasswordProblems,
  isPasswordAcceptable,
} from "@/lib/domain/admin-client-accounts";
import { AuthCard, AUTH_ERROR_STYLE, AUTH_LABEL_STYLE } from "@/components/auth/auth-card";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

type Phase = "checking" | "confirm" | "ready" | "invalid";
type StoredTokens = { accessToken: string; refreshToken: string };

export function ResetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tokensRef = useRef<StoredTokens | null>(null);
  const tokenHashRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const query = new URL(window.location.href).searchParams;
        const tokenHash = query.get("token_hash")?.trim() ?? "";
        if (tokenHash && (query.get("type") ?? "recovery") === "recovery") {
          // Não consome o token aqui: só após o clique em "Continuar".
          tokenHashRef.current = tokenHash;
          if (!cancelled) setPhase("confirm");
          return;
        }
        const callback = readActivationCallback(window.location.href);
        if (callback?.kind !== "implicit" || callback.type !== "recovery") {
          if (!cancelled) setPhase("invalid");
          return;
        }
        tokensRef.current = { accessToken: callback.accessToken, refreshToken: callback.refreshToken };
        const supabase = createClient();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken,
        });
        const url = new URL(window.location.href);
        url.hash = "";
        window.history.replaceState(window.history.state, "", url.toString());
        if (!cancelled) setPhase(sessionError ? "invalid" : "ready");
      } catch {
        if (!cancelled) setPhase("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onContinue = async () => {
    const tokenHash = tokenHashRef.current;
    if (!tokenHash || loading) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
      if (verifyError || !data.session) {
        console.error("recovery verifyOtp failed", verifyError?.code, verifyError?.status);
        setLoading(false);
        setPhase("invalid");
        return;
      }
      tokensRef.current = { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
      tokenHashRef.current = null;
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      window.history.replaceState(window.history.state, "", url.toString());
      setLoading(false);
      setPhase("ready");
    } catch (cause) {
      console.error("recovery verifyOtp exception", cause instanceof Error ? cause.name : "unknown");
      setLoading(false);
      setPhase("invalid");
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phase !== "ready") return;
    setError(null);
    if (password !== confirmation) {
      setError("As senhas não conferem.");
      return;
    }
    if (!isPasswordAcceptable(password)) {
      setError(
        password.length > ACCOUNT_PASSWORD_MAX_LENGTH
          ? `A senha pode ter no máximo ${ACCOUNT_PASSWORD_MAX_LENGTH} caracteres.`
          : `A senha precisa de: ${describePasswordProblems(password).join(", ") || `${ACCOUNT_PASSWORD_MIN_LENGTH} a ${ACCOUNT_PASSWORD_MAX_LENGTH} caracteres`}.`
      );
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      // A sessão pode ter sumido entre o link e o envio: restaura com os tokens guardados.
      const current = await supabase.auth.getSession();
      if (!current.data.session && tokensRef.current) {
        await supabase.auth.setSession({
          access_token: tokensRef.current.accessToken,
          refresh_token: tokensRef.current.refreshToken,
        });
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        console.error("recovery updateUser failed", updateError.code, updateError.status);
        setLoading(false);
        setError(
          passwordResetErrorMessage({
            code: updateError.code,
            status: updateError.status,
            message: updateError.message,
            name: updateError.name,
          })
        );
        return;
      }
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      router.replace("/login?senha=ok");
    } catch (cause) {
      // Exceção (ex.: falha de rede no fetch) não pode deixar o botão travado.
      setLoading(false);
      setError(passwordResetErrorMessage({ name: cause instanceof Error ? cause.name : null, message: cause instanceof Error ? cause.message : null }));
    }
  };

  return (
    <AuthCard
      title="Redefinir senha"
      subtitle={
        phase === "invalid"
          ? "Link inválido ou expirado."
          : "Escolha uma nova senha para a sua conta."
      }
      onSubmit={onSubmit}
    >
      {phase === "confirm" ? (
        <>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: t.color.textBody }}>
            Clique em continuar para validar o link e escolher sua nova senha.
          </p>
          <button type="button" onClick={onContinue} disabled={loading} className="nx-login-submit">
            {loading ? "Validando..." : "Continuar"}
          </button>
        </>
      ) : phase === "invalid" ? (
        <>
          <p role="alert" style={AUTH_ERROR_STYLE}>
            Este link de redefinição é inválido ou expirou.
          </p>
          <Link
            href="/esqueci-senha"
            className="nx-login-submit"
            style={{ display: "block", textAlign: "center", textDecoration: "none" }}
          >
            Solicitar novo link
          </Link>
          <div style={{ textAlign: "center" }}>
            <Link href="/login" className="nx-login-back">
              Voltar para o login
            </Link>
          </div>
        </>
      ) : (
        <>
          <label style={{ display: "block", fontSize: 14 }}>
            <span style={AUTH_LABEL_STYLE}>Nova senha</span>
            <input
              type="password"
              required
              minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
              maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="nx-login-input"
              placeholder="••••••••"
              disabled={phase !== "ready"}
            />
          </label>
          <label style={{ display: "block", fontSize: 14 }}>
            <span style={AUTH_LABEL_STYLE}>Confirmar nova senha</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="nx-login-input"
              placeholder="••••••••"
              disabled={phase !== "ready"}
            />
          </label>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: t.color.textMuted }}>
            Mín. 8 caracteres, com maiúscula, minúscula, número e símbolo.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, listStyle: "none" }}>
            {ACCOUNT_PASSWORD_REQUIREMENTS.map((r) => (
              <li key={r.id} style={{ color: r.test(password) ? "#34D399" : t.color.textMuted }}>
                {r.test(password) ? "✓ " : "• "}
                {r.label}
              </li>
            ))}
          </ul>
          {error ? <p role="alert" style={AUTH_ERROR_STYLE}>{error}</p> : null}
          <button type="submit" disabled={loading || phase !== "ready"} className="nx-login-submit">
            {loading ? "Salvando..." : phase === "checking" ? "Verificando link..." : "Redefinir senha"}
          </button>
        </>
      )}
    </AuthCard>
  );
}
