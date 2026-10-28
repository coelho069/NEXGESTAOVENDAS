"use client";

/**
 * Activation / password-definition screen reached from the Supabase invite link.
 *
 * Flow: the invite link establishes a recovery session in the browser client,
 * the visitor sets their own password via `auth.updateUser`, and the account is
 * marked `activated` through a server action. A session that is already logged
 * in (an administrator, for example) is not an invitation: the password form
 * stays closed unless that session owns a client account allowed to set one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, AUTH_ERROR_STYLE, AUTH_LABEL_STYLE, AUTH_OK_STYLE } from "@/components/auth/auth-card";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";
import {
  canDefineActivationPassword,
  readActivationCallback,
} from "@/lib/domain/activation-link";
import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  ACCOUNT_PASSWORD_REQUIREMENTS,
  describePasswordProblems,
  isPasswordAcceptable,
} from "@/lib/domain/admin-client-accounts";
import {
  defineActivationPasswordAction,
  getClientActivationEligibilityAction,
} from "@/lib/server/admin-client-account-actions";

type Phase = "checking" | "ready" | "invalid" | "submitting" | "done";

export function ActivateAccountForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const freshAccessLink = useRef(false);

  const checkSession = useCallback(async () => {
    try {
      const callback = readActivationCallback(window.location.href);
      freshAccessLink.current = callback !== null;
      const supabase = createClient();

      if (callback?.kind === "implicit") {
        const adopted = await fetch("/api/auth/activation-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            accessToken: callback.accessToken,
            refreshToken: callback.refreshToken,
          }),
        });
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken,
        });
        const url = new URL(window.location.href);
        url.hash = "";
        window.history.replaceState(window.history.state, "", url.toString());
        if (!adopted.ok || sessionError) {
          setPhase("invalid");
          return;
        }
        setPhase("ready");
        return;
      }

      if (callback?.kind === "pkce") {
        const exchanged = await supabase.auth.exchangeCodeForSession(callback.code);
        const session = exchanged.data.session;
        if (exchanged.error || !session) {
          setPhase("invalid");
          return;
        }
        const adopted = await fetch("/api/auth/activation-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
          }),
        });
        if (!adopted.ok) {
          setPhase("invalid");
          return;
        }
        setPhase("ready");
        return;
      }

      await supabase.auth.getSession();
      const eligibility = await getClientActivationEligibilityAction();
      if (
        !eligibility.ok ||
        !canDefineActivationPassword(eligibility.status, freshAccessLink.current)
      ) {
        setPhase("invalid");
        return;
      }

      setPhase("ready");
    } catch {
      setPhase("invalid");
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const problems = describePasswordProblems(password);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!isPasswordAcceptable(password)) {
      setError("A senha não atende aos requisitos mínimos.");
      return;
    }

    setPhase("submitting");
    const eligibility = await getClientActivationEligibilityAction();
    if (
      !eligibility.ok ||
      !canDefineActivationPassword(eligibility.status, freshAccessLink.current)
    ) {
      setPhase("invalid");
      return;
    }

    const defined = await defineActivationPasswordAction(password);
    if (!defined.ok) {
      setPhase("ready");
      setError(defined.error);
      return;
    }

    setPhase("done");
    router.replace("/pdv");
    router.refresh();
  }

  const isForm = phase === "ready" || phase === "submitting";
  const subtitle =
    phase === "checking"
      ? "Validando seu link de acesso..."
      : phase === "invalid"
        ? "O link não pode ser usado para definir sua senha."
        : phase === "done"
          ? "Acesso ativado"
          : "Defina uma senha para acessar o sistema. Ela será usada somente por você.";

  return (
      <AuthCard title="Ativar seu acesso" subtitle={subtitle} onSubmit={onSubmit}>
        {phase === "checking" ? (
          <p role="status" style={{ margin: 0, fontSize: 14, color: t.color.textMuted }}>
            Validando seu link de acesso...
          </p>
        ) : null}

        {phase === "invalid" ? (
          <>
            <div role="alert" style={AUTH_ERROR_STYLE}>
              <p style={{ margin: 0, fontWeight: 600 }}>Link inválido ou expirado</p>
              <p style={{ margin: "4px 0 0" }}>Solicite um novo link para definir sua senha.</p>
            </div>
            <a href="/esqueci-senha" className="nx-login-submit" style={{ display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
              Solicitar novo link
            </a>
            <div style={{ textAlign: "center" }}>
              <Link href="/login" className="nx-login-back">
                Ir para o login
              </Link>
            </div>
          </>
        ) : null}

        {phase === "done" ? (
          <p role="status" style={AUTH_OK_STYLE}>
            Acesso ativado. Redirecionando...
          </p>
        ) : null}

        {isForm ? (
          <>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: t.color.textMuted }}>
              {ACCOUNT_PASSWORD_REQUIREMENTS.map((requirement) => {
                const satisfied = requirement.test(password);
                return (
                  <li key={requirement.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span aria-hidden="true" style={{ color: satisfied ? "#34D399" : t.color.textMuted }}>
                      {satisfied ? "✓" : "•"}
                    </span>
                    <span style={{ color: satisfied ? "#6EE7B7" : undefined }}>{requirement.label}</span>
                    <span className="sr-only">{satisfied ? "atendido" : "pendente"}</span>
                  </li>
                );
              })}
            </ul>

            <label style={{ display: "block", fontSize: 14 }}>
              <span style={AUTH_LABEL_STYLE}>Nova senha</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={phase === "submitting"}
                className="nx-login-input"
                placeholder="••••••••"
              />
            </label>

            <label style={{ display: "block", fontSize: 14 }}>
              <span style={AUTH_LABEL_STYLE}>Confirmar senha</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={phase === "submitting"}
                className="nx-login-input"
                placeholder="••••••••"
              />
            </label>

            {error ? (
              <p role="alert" style={AUTH_ERROR_STYLE}>
                {error}
              </p>
            ) : null}

            <button type="submit" disabled={phase === "submitting" || problems.length > 0} className="nx-login-submit">
              {phase === "submitting" ? "Ativando..." : "Ativar acesso"}
            </button>

            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: t.color.textMuted, textAlign: "center" }}>
              Após ativar, entre em /login com seu e-mail. Nunca compartilhe este link.
            </p>
          </>
        ) : null}
      </AuthCard>
  );
}
