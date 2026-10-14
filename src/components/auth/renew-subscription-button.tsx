"use client";

import { useState } from "react";

/** Botão "Renovar": abre o Checkout Pro ancorado na org do usuário logado. */
export function RenewSubscriptionButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-testid="subscription-renew"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(false);
          try {
            const response = await fetch("/api/subscriptions/renew", { method: "POST" });
            const payload = (await response.json()) as { init_point?: string };
            if (!response.ok || !payload.init_point) {
              setError(true);
              return;
            }
            window.location.assign(payload.init_point);
          } catch {
            setError(true);
          } finally {
            setLoading(false);
          }
        }}
        className={
          className ??
          "inline-flex items-center justify-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
        }
      >
        {loading ? "Abrindo pagamento..." : "Renovar"}
      </button>
      {error ? (
        <p data-testid="subscription-renew-error" className="text-xs text-rose-700">
          Não foi possível abrir a renovação. Tente de novo ou fale com o suporte.
        </p>
      ) : null}
    </div>
  );
}
