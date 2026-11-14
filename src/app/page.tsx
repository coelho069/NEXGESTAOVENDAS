import type { Metadata } from "next";
import localFont from "next/font/local";
import { LandingPage } from "@/components/landing/LandingPage";

/**
 * Landing de conversão montada na raiz `/` (ver deploy/portable/landing/PORTING.md).
 * As fontes do style guide (Plus Jakarta Sans + Inter) entram via `next/font`
 * (self-host + zero layout shift) em vez de `@import` do Google Fonts, que a CSP
 * de produção (`style-src 'self' 'unsafe-inline'` / `font-src 'self' data:`)
 * bloquearia. As variáveis CSS alimentam os tokens do kit (landing-theme.ts).
 */
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-inter",
});

const jakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin-variable.woff2",
  weight: "600 800",
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — PDV, estoque e gestão comercial",
  description:
    "PDV offline-first, controle de estoque auditado e cadastro de clientes em uma plataforma para varejo brasileiro. Veja os planos e comece agora.",
};

export default function HomePage() {
  return (
    <div className={`${inter.variable} ${jakarta.variable}`}>
      <LandingPage />
    </div>
  );
}
