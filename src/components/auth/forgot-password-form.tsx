"use client";

import { useState } from "react";
import { AuthCard, AUTH_ERROR_STYLE, AUTH_LABEL_STYLE, AUTH_OK_STYLE } from "@/components/auth/auth-card";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setError("Muitas solicitações. Tente novamente mais tarde.");
      } else {
        setMessage("Se o e-mail existir, enviaremos um link.");
      }
    } catch {
      setError("Não foi possível enviar agora. Tente novamente.");
    }
    setLoading(false);
  };

  return (
    <AuthCard
      title="Esqueci minha senha"
      subtitle="Informe seu e-mail para receber um link de redefinição."
      onSubmit={onSubmit}
    >
      <label style={{ display: "block", fontSize: 14 }}>
        <span style={AUTH_LABEL_STYLE}>E-mail</span>
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
      {message ? <p role="status" style={AUTH_OK_STYLE}>{message}</p> : null}
      {error ? <p role="alert" style={AUTH_ERROR_STYLE}>{error}</p> : null}
      <button type="submit" disabled={loading} className="nx-login-submit">
        {loading ? "Enviando..." : "Enviar link"}
      </button>
    </AuthCard>
  );
}
