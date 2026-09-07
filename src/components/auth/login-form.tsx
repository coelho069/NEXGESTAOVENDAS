"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-md space-y-5 rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          N
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Entrar no PDV</h1>
          <p className="text-sm text-slate-500">Use as credenciais fornecidas pelo administrador.</p>
        </div>
      </div>
      <label className="block text-sm">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">E-mail</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Senha</span>
        <input
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white outline-none transition hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:bg-slate-300"
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
