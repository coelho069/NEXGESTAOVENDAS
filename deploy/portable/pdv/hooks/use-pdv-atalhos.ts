/**
 * Atalhos globais de teclado — jornada 100% teclado (spec v2, rigoroso).
 * -----------------------------------------------------------------------------
 *   F2  -> foco na BarraBuscaPdv
 *   F4  -> MODO QUANTIDADE (próximo item entra com qty>1)
 *   F8  -> MODO DESCONTO (valor em R$ no painel de totais)
 *   F9  -> CANCELAR ITEM (linha focada do cupom; senão a última)
 *   F12 -> FINALIZAR venda (abre a sheet de pagamento)
 *   Esc -> fechar sheet / limpar modos / limpar busca
 *
 * UX: `preventDefault` SEMPRE em F-keys — DevTools/help do browser nunca
 * intercepta o fluxo do caixa em pleno atendimento.
 */

import { useEffect, useRef } from 'react';

export type AcaoPdv =
  | 'focar-busca'
  | 'modo-quantidade'
  | 'modo-desconto'
  | 'cancelar-item'
  | 'finalizar-venda'
  | 'limpar-modos';

export interface HandlerPdv {
  (acao: AcaoPdv): void;
}

export interface PdvAtalhosApi {
  /** Ref p/ anexar na BarraBuscaPdv (F2 foca aqui). Tipo estrutural que
   *  satisfaz React 18 (MutableRefObject) e React 19 (RefObject). */
  buscaRef: { current: HTMLInputElement | null };
  focarBusca: () => void;
}

/**
 * Registra listeners globais. `habilitado=false` quando o Sheet de pagamento
 * está aberto: Esc passa a ser consumido pelo sheet (fechar), não pelos modos.
 */
export function usePdvAtalhos(
  aoAcao: HandlerPdv,
  habilitado = true,
): PdvAtalhosApi {
  const buscaRef = useRef<HTMLInputElement | null>(null);
  const aoAcaoRef = useRef(aoAcao);
  aoAcaoRef.current = aoAcao;

  const focarBusca = () => buscaRef.current?.focus();

  useEffect(() => {
    if (!habilitado) return;

    const onKeyDown = (ev: globalThis.KeyboardEvent) => {
      switch (ev.key) {
        case 'F2':
          ev.preventDefault();
          buscaRef.current?.focus();
          buscaRef.current?.select();
          aoAcaoRef.current('focar-busca');
          break;
        case 'F4':
          ev.preventDefault();
          aoAcaoRef.current('modo-quantidade');
          break;
        case 'F8':
          ev.preventDefault();
          aoAcaoRef.current('modo-desconto');
          break;
        case 'F9':
          ev.preventDefault();
          aoAcaoRef.current('cancelar-item');
          break;
        case 'F12':
          ev.preventDefault();
          aoAcaoRef.current('finalizar-venda');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [habilitado]);

  return { buscaRef, focarBusca };
}
