import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { LoginForm } from "@/components/auth/login-form";

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
