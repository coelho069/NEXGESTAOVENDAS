'use client';

/**
 * Wrapper client-only para o SuporteOperacional — dynamic import com
 * ssr:false (padrão do projeto para componentes flutuantes globais,
 * ver BUG-NEX-HYDRATION-418 no histórico).
 */
import dynamic from 'next/dynamic';

const SuporteOperacionalLazy = dynamic(
  () => import('./suporte-operacional').then((mod) => mod.SuporteOperacional),
  { ssr: false },
);

export function SuporteOperacionalClient() {
  return <SuporteOperacionalLazy />;
}
