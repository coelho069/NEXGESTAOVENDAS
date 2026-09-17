import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SyncProvider } from "@/components/providers/sync-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Nex Gestão Vendas — PDV",
  description: "PDV local-first Sprint 4",
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
