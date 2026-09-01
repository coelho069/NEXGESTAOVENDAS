"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("cashier@example.invalid");
  const [password, setPassword] = useState("Cashier123!");
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
      setError(signInError.message);
      return;
    }

    router.replace("/pdv");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Entrar no PDV</h1>
        <p className="text-sm text-slate-500">Use o usuário caixa do seed demo.</p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">E-mail</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Senha</span>
        <input
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:bg-slate-300"
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
