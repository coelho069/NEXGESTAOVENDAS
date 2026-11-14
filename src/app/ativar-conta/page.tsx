import type { Metadata } from "next";
import localFont from "next/font/local";
import { ActivateAccountForm } from "@/components/auth/activate-account-form";

const inter = localFont({
  src: "../fonts/inter-latin-variable.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-inter",
});

const jakarta = localFont({
  src: "../fonts/plus-jakarta-sans-latin-variable.woff2",
  weight: "600 800",
  display: "swap",
  variable: "--font-jakarta",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ativar acesso — Nex Gestão Vendas",
  description: "Defina sua senha para ativar o acesso ao Nex Gestão Vendas.",
};

/**
 * Public by design: the Supabase invite link must reach this page while the
 * visitor has no session yet. Authorization for everything behind the login
 * keeps living in /admin and /pdv (see src/middleware.ts).
 */
export default function ActivateAccountPage() {
  return (
    <div className={`${inter.variable} ${jakarta.variable}`}>
      <ActivateAccountForm />
    </div>
  );
}
