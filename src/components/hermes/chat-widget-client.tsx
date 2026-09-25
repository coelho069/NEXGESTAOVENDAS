'use client';

/**
 * Wrapper client-side para carregar o HermesChatWidget sem SSR.
 * [BUG-NEX-HYDRATION-418] Next.js App Router não permite `ssr: false`
 * diretamente em Server Components — por isso este wrapper existe:
 * ele é um Client Component que faz o dynamic import com ssr desabilitado,
 * eliminando o mismatch de hidratação (React Error #418).
 */
import dynamic from 'next/dynamic';

// ssr:false => o widget só monta no client; sem HTML pré-renderizado para divergir
const HermesChatWidgetLazy = dynamic(
  () => import('./chat-widget').then((mod) => mod.HermesChatWidget),
  { ssr: false },
);

export function HermesChatWidgetLazyMount() {
  return <HermesChatWidgetLazy />;
}
