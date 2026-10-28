"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { endClientSession } from "@/lib/offline/end-session";
import { RenewSubscriptionButton } from "@/components/auth/renew-subscription-button";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

/** Botões secundários: superfície escura translúcida com borda do login. */
const GHOST_BUTTON_STYLE = {
  border: `1px solid ${t.color.borderStrong}`,
  background: "rgba(15, 23, 42, 0.55)",
  color: t.color.text,
} as const;

/** Actions shown on the subscription block screen. */
export function SubscriptionBlockedActions() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  return (
    <div data-testid="subscription-blocked-actions" className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <RenewSubscriptionButton />
      <Link
        href="/planos"
        data-testid="subscription-blocked-resubscribe"
        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold hover:bg-white/5"
        style={GHOST_BUTTON_STYLE}
      >
        Assinar novamente
      </Link>
      <Link
        href="/suporte/tickets"
        data-testid="subscription-blocked-support"
        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold hover:bg-white/5"
        style={GHOST_BUTTON_STYLE}
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
        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ color: "#FDA4AF" }}
      >
        {leaving ? "Saindo..." : "Sair da conta"}
      </button>
    </div>
  );
}
