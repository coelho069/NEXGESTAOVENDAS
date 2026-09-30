import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SyncProvider } from "@/components/providers/sync-provider";
import { AnneSupportWidget } from "@/components/support/anne-support-widget";
import { SuporteOperacionalClient } from "@/components/support/suporte-operacional-client";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — PDV",
  description: "PDV local-first Sprint 4",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} bg-slate-50 text-slate-900 antialiased`}>
        <SyncProvider>
          {children}
          <SuporteOperacionalClient />
          <AnneSupportWidget />
        </SyncProvider>
      </body>
    </html>
  );
}
