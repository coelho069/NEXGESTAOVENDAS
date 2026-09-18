import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SyncProvider } from "@/components/providers/sync-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Nex Gestão Vendas | Sistema de Gestão, Vendas e Estoque",
  description:
    "PDV local-first, inventário auditado e dashboard de métricas para varejo brasileiro. Controle vendas, estoque e resultados em um só lugar.",
  openGraph: {
    title: "Nex Gestão Vendas | Sistema de Gestão, Vendas e Estoque",
    description:
      "PDV local-first, inventário auditado e dashboard de métricas para varejo brasileiro. Controle vendas, estoque e resultados em um só lugar.",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <SyncProvider>{children}</SyncProvider>
      </body>
    </html>
  );
}
