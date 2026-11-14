import type { Metadata } from "next";
import localFont from "next/font/local";
import { SyncProvider } from "@/components/providers/sync-provider";
import { AnneSupportWidget } from "@/components/support/anne-support-widget";
import "./globals.css";

const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "400 600",
});

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — Planos PDV",
  description: "Planos de assinatura do PDV local-first Nex Gestão Vendas para varejo brasileiro.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <SyncProvider>
          {children}
          {/* Único canal de suporte na tela — FAB Anne (rotas autenticadas, client-only). */}
          <AnneSupportWidget />
        </SyncProvider>
      </body>
    </html>
  );
}
