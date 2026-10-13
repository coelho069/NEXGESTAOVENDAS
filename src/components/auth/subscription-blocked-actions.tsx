"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { endClientSession } from "@/lib/offline/end-session";

/** Actions shown on the subscription block screen. */
export function SubscriptionBlockedActions() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  return (
    <div data-testid="subscription-blocked-actions" className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Link
        href="/planos"
        data-testid="subscription-blocked-resubscribe"
        className="inline-flex items-center justify-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
      >
        Assinar novamente
      </Link>
      <Link
        href="/suporte"
        data-testid="subscription-blocked-support"
        className="inline-flex items-center justify-center rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-100"
      >
        Falar com o suporte
      </Link>
      <button
        type="button"
        data-testid="subscription-blocked-signout"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true);
          try {
            await endClientSession();
          } finally {
            router.replace("/login");
          }
        }}
        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {leaving ? "Saindo..." : "Sair da conta"}
      </button>
    </div>
  );
}
