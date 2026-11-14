import type { Metadata } from "next";
import localFont from "next/font/local";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

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
  title: "Esqueci minha senha — Nex Gestão Vendas",
  robots: { index: false },
};

/** Pública por design: o usuário ainda não tem sessão (ver src/middleware.ts). */
export default function Page() {
  return (
    <div className={`${inter.variable} ${jakarta.variable}`}>
      <ForgotPasswordForm />
    </div>
  );
}
