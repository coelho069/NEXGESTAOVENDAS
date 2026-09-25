/**
 * Root Layout do NEX Gestão Vendas (Next.js App Router).
 * Layout de referência do deploy — injeta o HermesChatWidget globalmente.
 *
 * IMPORTANTE: este arquivo é a versão canônica deste repositório de deploy.
 * Se o projeto real do NEX já tiver um layout.tsx, portee APENAS as duas
 * linhas marcadas com [BUG-NEX-CHAT-001] para ele — não substitua o layout
 * de produção por este.
 */
import type { Metadata, Viewport } from 'next';
// [BUG-NEX-HYDRATION-418] import dinâmico (ssr:false) via wrapper client —
// o widget só monta no browser; sem SSR => sem mismatch => sem Error #418.
import { HermesChatWidgetLazyMount } from '@/components/hermes/chat-widget-client';

export const metadata: Metadata = {
  title: 'NEX Gestão Vendas',
  description: 'PDV offline-first do NEX Gestão Vendas',
};

// UI mobile-first/tablet-ready; viewport-fit cobre safe-areas de tablet
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-slate-100 antialiased">
        {children}
        {/* [BUG-NEX-HYDRATION-418] montagem client-only (Step 1) */}
        <HermesChatWidgetLazyMount />
      </body>
    </html>
  );
}
