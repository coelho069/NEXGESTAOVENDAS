import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { ActivateAccountForm } from "@/components/auth/activate-account-form";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
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
    <div className={`pdv-theme ${inter.variable} ${jakarta.variable}`}>
      <ActivateAccountForm />
    </div>
  );
}
