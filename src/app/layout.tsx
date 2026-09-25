import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SyncProvider } from "@/components/providers/sync-provider";
// [BUG-NEX-HYDRATION-418] widget do Hermes montado apenas no client
// (dynamic import com ssr:false) — sem SSR, não há mismatch de hidratação.
import { HermesChatWidgetLazyMount } from "@/components/hermes/chat-widget-client";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — Planos PDV",
  description: "Planos de assinatura do PDV local-first Nex Gestão Vendas para varejo brasileiro.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <SyncProvider>{children}</SyncProvider>
        {/* [BUG-NEX-HYDRATION-418] montagem client-only, fora do fluxo SSR */}
        <HermesChatWidgetLazyMount />
      </body>
    </html>
  );
}
