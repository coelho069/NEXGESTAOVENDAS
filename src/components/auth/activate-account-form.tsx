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
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg backdrop-blur-xl sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          NEXGESTAOVENDAS
        </p>
        <h1
          className="mt-2 text-2xl font-bold tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}
        >
          Ativar seu acesso
        </h1>

        {phase === "checking" ? (
          <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            Validando seu link de acesso...
          </p>
        ) : null}

        {phase === "invalid" ? (
          <div role="alert" className="pdv-alert-error mt-6">
            <p className="font-semibold">Link inválido ou expirado</p>
            <p className="mt-1">
              Solicite um novo envio ao suporte ou use a recuperação de senha na página de login.
            </p>
            <a href="/login" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
              Ir para o login
            </a>
          </div>
        ) : null}

        {phase === "done" ? (
          <p role="status" className="mt-6 flex items-center gap-2 text-sm text-emerald-300">
            <ShieldCheck size={16} aria-hidden="true" />
            Acesso ativado. Redirecionando...
          </p>
        ) : null}

        {phase === "ready" || phase === "submitting" ? (
          <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
            <p className="text-sm text-muted-foreground">
              Defina uma senha para acessar o sistema. Ela será usada somente por você.
            </p>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-foreground">Nova senha</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={phase === "submitting"}
                className="pdv-input"
              />
            </label>

            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {ACCOUNT_PASSWORD_REQUIREMENTS.map((requirement) => {
                const satisfied = requirement.test(password);
                return (
                  <li key={requirement.id} className="flex items-center gap-2">
                    <span aria-hidden="true" className={satisfied ? "text-emerald-400" : "text-muted-foreground"}>
                      {satisfied ? "✓" : "•"}
                    </span>
                    <span className={satisfied ? "text-emerald-300" : undefined}>
                      {requirement.label}
                    </span>
                    <span className="sr-only">{satisfied ? "atendido" : "pendente"}</span>
                  </li>
                );
              })}
            </ul>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-semibold text-foreground">Confirmar senha</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={phase === "submitting"}
                className="pdv-input"
              />
            </label>

            {error ? (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={phase === "submitting" || problems.length > 0}
              className="pdv-btn-primary inline-flex items-center justify-center gap-2"
            >
              {phase === "submitting" ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound size={16} aria-hidden="true" />
              )}
              Ativar acesso
            </button>

            <p className="text-xs text-muted-foreground">
              Após ativar, entre em /login com seu e-mail. Nunca compartilhe este link.
            </p>
          </form>
        ) : null}
      </div>
    </main>
  );
}
