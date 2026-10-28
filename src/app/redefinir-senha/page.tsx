import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-inter" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["600", "700", "800"], display: "swap", variable: "--font-jakarta" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Redefinir senha — Nex Gestão Vendas",
  robots: { index: false },
};

/** Pública por design: o usuário ainda não tem sessão (ver src/middleware.ts). */
export default function Page() {
  return (
    <div className={`${inter.variable} ${jakarta.variable}`}>
      <ResetPasswordForm />
    </div>
  );
}
