import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SyncProvider } from "@/components/providers/sync-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — PDV",
  description: "PDV local-first Sprint 1",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} bg-slate-50 text-slate-900 antialiased`}>
        <SyncProvider>{children}</SyncProvider>
      </body>
    </html>
  );
}
