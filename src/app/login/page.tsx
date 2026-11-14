import type { Metadata } from "next";
import localFont from "next/font/local";
import { LoginForm } from "@/components/auth/login-form";

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

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — Entrar no PDV",
  description:
    "Acesse o PDV Nex Gestão Vendas com as credenciais fornecidas pelo administrador da sua loja.",
};

export default function LoginPage() {
  return (
    <div className={`${inter.variable} ${jakarta.variable}`}>
      <LoginForm />
    </div>
  );
}
