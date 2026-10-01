/**
 * Hook de estado do cupom (UI only) — NENHUMA regra fiscal aqui.
 * -----------------------------------------------------------------------------
 * UX (PRD): adicionar produto é O(1) — bip ou Enter na busca, SEM modal.
 * "Adição de item em no máximo 2 toques após o código": Enter adiciona e já
 * limpa a busca (toque 0 extra); toque 1 = produto na GradeAtalhos.
 *
 * Aritmética 100% em centavos (ver lib/money.ts). Persistência da venda segue
 * na camada de persistência fiscal existente — fora do escopo deste refactor.
 */

import { useCallback, useMemo, useState } from 'react';
import type { LinhaCupom, Pagamento, Produto } from '../lib/types';
import {
  totalLinhaCentavos,
  somaCentavos,
} from '../lib/money';

export interface CarrinhoPdv {
  linhas: LinhaCupom[];
  /** Soma das linhas em centavos (prévia — fiscal é emitido pelo host). */
  subtotalCentavos: number;
  /** Desconto manual em centavos (F8), limitado ao subtotal. */
  descontoCentavos: number;
  setDescontoCentavos: (centavos: number) => void;
  /** subtotal - desconto. É o valor exibido como Total a Pagar. */
  totalCentavos: number;
  /** Quantidade de itens (soma das quantidades) p/ o badge do cupom. */
  totalItens: number;
  adicionarProduto: (produto: Produto, quantidade?: number) => void;
  incrementar: (produtoId: string) => void;
  decrementar: (produtoId: string) => void;
  removerLinha: (produtoId: string) => void;
  /** F9 "cancelar item": remove a última linha (fallback do PdvScreen). */
  removerUltimo: () => void;
  limpar: () => void;
  /** Registra um pagamento parcial (sheet de pagamentos mistos). */
  registrarPagamento: (pagamento: Pagamento) => void;
  pagamentos: Pagamento[];
  /** (total - pago) em centavos. Negativo = troco a devolver. */
  saldoCentavos: () => number;
}

/** Agrupa por produto: bipar o mesmo código 2x aumenta a quantidade (O(1)). */
function agrupar(
  linhas: LinhaCupom[],
  produto: Produto,
  quantidade: number,
): LinhaCupom[] {
  const indice = linhas.findIndex((l) => l.produto.id === produto.id);
  if (indice === -1) {
    return [...linhas, { produto, quantidade: Math.max(1, quantidade) }];
  }
  const novas = [...linhas];
  const atual = novas[indice];
  if (!atual) return linhas; // defesa p/ noUncheckedIndexedAccess
  novas[indice] = { ...atual, quantidade: atual.quantidade + Math.max(1, quantidade) };
  return novas;
}

export function usePdvCart(): CarrinhoPdv {
  const [linhas, setLinhas] = useState<LinhaCupom[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [descontoCentavos, setDescontoState] = useState(0);

  const adicionarProduto = useCallback((produto: Produto, quantidade = 1) => {
    setLinhas((atuais) => agrupar(atuais, produto, quantidade));
  }, []);

  const incrementar = useCallback((produtoId: string) => {
    setLinhas((atuais) =>
      atuais.map((l) =>
        l.produto.id === produtoId ? { ...l, quantidade: l.quantidade + 1 } : l,
      ),
    );
  }, []);

  // Decrementar até 1 na linha; remover é gesto explícito (evita apagar item
  // com toque acidental — eliminação de erros de toque, PRD).
  const decrementar = useCallback((produtoId: string) => {
    setLinhas((atuais) =>
      atuais.map((l) =>
        l.produto.id === produtoId && l.quantidade > 1
          ? { ...l, quantidade: l.quantidade - 1 }
          : l,
      ),
    );
  }, []);

  const removerLinha = useCallback((produtoId: string) => {
    setLinhas((atuais) => atuais.filter((l) => l.produto.id !== produtoId));
  }, []);

  // F9 "cancelar item" sem alvo: remove a última linha bipada.
  const removerUltimo = useCallback(() => {
    setLinhas((atuais) => atuais.slice(0, -1));
  }, []);

  const limpar = useCallback(() => {
    setLinhas([]);
    setPagamentos([]);
    setDescontoState(0);
  }, []);

  // Desconto limitado ao subtotal: nunca vira venda negativa.
  const setDescontoCentavos = useCallback(
    (centavos: number) => {
      setDescontoState(Math.max(0, Math.trunc(centavos)));
    },
    [],
  );

  const subtotalCentavos = useMemo(
    () =>
      somaCentavos(
        linhas.map((l) => totalLinhaCentavos(l.produto.unit_price, l.quantidade)),
      ),
    [linhas],
  );

  const totalCentavos = useMemo(
    () => Math.max(0, subtotalCentavos - descontoCentavos),
    [subtotalCentavos, descontoCentavos],
  );

  const totalItens = useMemo(
    () => linhas.reduce((acc, l) => acc + l.quantidade, 0),
    [linhas],
  );

  const saldoCentavos = useCallback(() => {
    const pago = somaCentavos(pagamentos.map((p) => p.centavos));
    return totalCentavos - pago; // negativo => troco
  }, [pagamentos, totalCentavos]);

  return {
    linhas,
    subtotalCentavos,
    descontoCentavos,
    setDescontoCentavos,
    totalCentavos,
    totalItens,
    adicionarProduto,
    incrementar,
    decrementar,
    removerLinha,
    removerUltimo,
    limpar,
    registrarPagamento,
    pagamentos,
    saldoCentavos,
  };
}
