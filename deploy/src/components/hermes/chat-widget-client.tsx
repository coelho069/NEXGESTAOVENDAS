'use client';

/**
 * Wrapper client-side para carregar o HermesChatWidget sem SSR.
 * [BUG-NEX-HYDRATION-418] Next.js App Router não permite `ssr: false`
 * diretamente em Server Components — por isso este wrapper existe:
 * ele é um Client Component que faz o dynamic import com ssr desabilitado,
 * eliminando o mismatch de hidratação (React Error #418).
 *
 * Visibilidade: só monta em rotas autenticadas do app (não landing/login)
 * e quando o backend confirma XAI_API_KEY configurada (GET /api/hermes/chat).
 */
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';

const PUBLIC_HERMES_PATHS = new Set(['/', '/login', '/auth/callback']);

function isPublicHermesPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return PUBLIC_HERMES_PATHS.has(pathname);
}

// ssr:false => o widget só monta no client; sem HTML pré-renderizado para divergir
const HermesChatWidgetLazy = dynamic(
  () => import('./chat-widget').then((mod) => mod.HermesChatWidget),
  { ssr: false },
);

export function HermesChatWidgetLazyMount() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading || !user || isPublicHermesPath(pathname)) {
      setConfigured(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/hermes/chat');
        if (!res.ok) {
          if (!cancelled) setConfigured(false);
          return;
        }
        const data = (await res.json()) as { configured?: boolean };
        if (!cancelled) setConfigured(Boolean(data.configured));
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, pathname]);

  if (loading || !user || isPublicHermesPath(pathname) || configured !== true) {
    return null;
  }

  return <HermesChatWidgetLazy />;
}
