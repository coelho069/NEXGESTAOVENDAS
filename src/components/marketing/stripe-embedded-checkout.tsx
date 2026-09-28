"use client";

/**
 * Stripe Checkout Studio — Embedded Form (Client).
 *
 * Loads Stripe.js from the pinned dahlia CDN (never bundled), then boots the
 * Checkout SDK with the custom_checkout_payment_form beta and renders the form
 * into #checkout-form. Complements — not replaces — the PIX / fallback / Mercado
 * Pago rails: this is solely the card / Checkout Studio subscription path.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// Pin the dahlia script source — do not bundle Stripe.js.
const STRIPE_DAHLIA_JS = "https://js.stripe.com/dahlia/stripe.js";
// Beta enabling the custom checkout payment form (client-side).
const STRIPE_EMBEDDED_BETA = "custom_checkout_payment_form_1";

/** Exact appearance required by fixed_by_ui. */
const EMBEDDED_FORM_APPEARANCE = {
  theme: "night",
  labels: "auto",
  inputs: "condensed",
  variables: {
    borderRadius: "4px",
    colorBackground: "#ffffff",
    colorDanger: "#df1b41",
    colorPrimary: "#0570de",
    colorSuccess: "#00c853",
    colorText: "#30313d",
    fontFamily: "default",
    fontSizeBase: "16px",
    spacingUnit: "4px",
  },
} as const;

type StripeLike = {
  initCheckoutFormSdk?: (config: {
    clientSecret: string;
    appearance: unknown;
  }) => Promise<{
    createForm: (config: { layout: string }) => Promise<{
      mount: (container: string | HTMLElement) => Promise<void>;
      loadActions: () => Promise<{
        confirm: () => Promise<unknown>;
      }>;
      on: (event: string, handler: (payload: { actions: { confirm: () => Promise<unknown> } }) => void) => void;
    }>;
  }>;
};

declare global {
  interface Window {
    Stripe?: (pk: string, options?: { betas?: string[] }) => StripeLike;
    __stripeEmbeddedFormLoaded?: boolean;
  }
}

function loadDahliaStripeJs(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Stripe) {
      resolve();
      return;
    }
    if (document.querySelector(`script[src="${STRIPE_DAHLIA_JS}"]`)) {
      // already loading — poll for window.Stripe
      const tick = setInterval(() => {
        if (window.Stripe) {
          clearInterval(tick);
          resolve();
        }
      }, 50);
      return;
    }
    const script = document.createElement("script");
    script.src = STRIPE_DAHLIA_JS;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("stripe_dahlia_load_failed"));
    document.head.appendChild(script);
  });
}

export function StripeEmbeddedCheckout({
  planId,
  payerEmail,
  publishableKey,
}: {
  planId: string;
  payerEmail: string;
  publishableKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!publishableKey) {
        setError("stripe_publishable_key_missing");
        setLoading(false);
        return;
      }
      try {
        await loadDahliaStripeJs();
        if (cancelled || !window.Stripe) return;

        const stripe = window.Stripe(publishableKey, {
          betas: [STRIPE_EMBEDDED_BETA],
        });

        const response = await fetch("/api/subscriptions/stripe/public-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: planId,
            payer_email: payerEmail,
            client_mutation_id: crypto.randomUUID(),
          }),
        });
        const payload = (await response.json()) as { client_secret?: string; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.client_secret) {
          setError(payload.error ?? "checkout_unavailable");
          setLoading(false);
          return;
        }

        if (!stripe.initCheckoutFormSdk) {
          setError("initCheckoutFormSdk_unavailable");
          setLoading(false);
          return;
        }

        const sdk = await stripe.initCheckoutFormSdk({
          clientSecret: payload.client_secret,
          appearance: EMBEDDED_FORM_APPEARANCE,
        });

        const form = await sdk.createForm({ layout: "expanded" });
        if (cancelled || !containerRef.current) return;
        await form.mount(containerRef.current);

        form.on("confirm", (payload) => {
          void payload.actions.confirm();
        });

        await form.loadActions();
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setError("checkout_unavailable");
          setLoading(false);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [planId, payerEmail, publishableKey]);

  if (error) {
    return (
      <p role="alert" className="text-center text-sm text-rose-600">
        Não foi possível carregar o checkout. Tente novamente.
      </p>
    );
  }

  return (
    <div className="relative w-full">
      <div id="checkout-form" ref={containerRef} className="w-full" />
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          Carregando checkout…
        </div>
      ) : null}
    </div>
  );
}
