/**
 * PdvScreen — tela operacional do PDV (spec v2).
 * -----------------------------------------------------------------------------
 * Layout em 2 colunas: busca+atalhos+cupom | totais sticky à direita.
 *  - Total SEMPRE visível sem scroll; adição SEM modal (bip + Enter).
 *  - F4 MODO QUANTIDADE: "F4, 3, bip" entra 3 unidades de uma vez — jornada
 *    de balcão clássica sem abrir modal.
 *  - F8 MODO DESCONTO: inline no PainelTotais, Enter confirma, Esc cancela.
 *  - F9 CANCELAR ITEM: linha focada do cupom ou a última bipada.
 *  - F12 FINALIZAR: abre a sheet de pagamento.
 *  - Esc: fecha sheet, limpa busca, desarma modos — nunca deixa o caixa
 *    "preso" num modo sem querer.
 *
 * Integração (PORTING): injete o cliente Supabase do projeto real em
 * `supabaseClient`; a persistência da venda é callback do host — aqui NÃO
 * há escrita em banco (system_integrity da spec: ui_direct_write=false).
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pdvTheme as t } from './theme/pdv-theme';
import type { EstadoConexao, Pagamento, Produto } from './lib/types';
import {
  buscarProdutos,
  carregarCatalogo,
  SEED_OFFLINE,
  type SupabaseLike,
} from './lib/pdv-catalog';
import { usePdvCart } from './hooks/use-pdv-cart';
import { usePdvAtalhos, type AcaoPdv } from './hooks/use-pdv-atalhos';
import { BarraBuscaPdv } from './components/BarraBuscaPdv';
import { GradeAtalhos } from './components/GradeAtalhos';
import { ListaCupom } from './components/ListaCupom';
import { PainelTotais } from './components/PainelTotais';
import { SheetPagamento } from './components/SheetPagamento';

interface Props {
  /** Cliente supabase-js do projeto real (credenciais de lá). */
  supabaseClient: SupabaseLike | null;
  /** Persistência fiscal é do host (spec: fiscal_layer external_to_package). */
  onVendaConfirmada?: (resumo: {
    totalCentavos: number;
    descontoCentavos: number;
    pagamentos: Pagamento[];
  }) => void;
}

export function PdvScreen({ supabaseClient, onVendaConfirmada }: Props) {
  const cart = usePdvCart();
  const [resultados, setResultados] = useState<Produto[]>([]);
  const [conexao, setConexao] = useState<EstadoConexao>({ tipo: 'carregando' });
  const [termo, setTermo] = useState('');
  const [sheetAberta, setSheetAberta] = useState(false);

  // -------- MODO QUANTIDADE (F4): qty armada p/ o próximo item adicionado
  const [qtyArmada, setQtyArmada] = useState(1);
  const [modoQuantidade, setModoQuantidade] = useState(false);

  // -------- F9: qual linha o operador está "mirando" no cupom
  const [idLinhaFocada, setIdLinhaFocada] = useState<string | null>(null);

  const gradeRef = useRef<HTMLDivElement | null>(null);
  const cupomRef = useRef<HTMLDivElement | null>(null);

  // ------------------------------------------------------------------
  // Catálogo: carrega na montagem; fallback SEED_OFFLINE se falhar.
  // ------------------------------------------------------------------
  const sincronizar = useCallback(async () => {
    setConexao({ tipo: 'carregando' });
    const r = await carregarCatalogo(supabaseClient);
    if (r.ok) {
      setResultados(r.produtos.slice(0, 12));
      setConexao({ tipo: 'online' });
    } else {
      setResultados(SEED_OFFLINE.slice(0, 12));
      setConexao({ tipo: 'offline', motivo: r.motivo, pendentes: r.pendentes });
    }
  }, [supabaseClient]);

  useEffect(() => {
    void sincronizar();
  }, [sincronizar]);

  // ------------------------------------------------------------------
  // Busca com debounce de 120ms — bip é instantâneo; digitação não inunda
  // o PostgREST de requisições.
  // ------------------------------------------------------------------
  useEffect(() => {
    const limpo = termo.trim();
    if (limpo === '') {
      setResultados((atuais) =>
        atuais.length > 0 ? atuais.slice(0, 12) : SEED_OFFLINE.slice(0, 12),
      );
      return;
    }
    const timer = setTimeout(async () => {
      const r = await buscarProdutos(limpo, supabaseClient);
      if (r.ok) {
        setResultados(r.produtos);
        if (r.fonte === 'rede') setConexao({ tipo: 'online' });
      } else {
        setConexao({ tipo: 'offline', motivo: r.motivo, pendentes: r.pendentes });
        setResultados([]); // dropdown some; flash de erro fica na barra
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [termo, supabaseClient]);

  // ------------------------------------------------------------------
  // Atalhos (spec v2) — sheet aberta desabilita F-keys globais.
  // ------------------------------------------------------------------
  const aoAcao = useCallback(
    (acao: AcaoPdv) => {
      switch (acao) {
        case 'modo-quantidade':
          // F4 arma o modo; qty "solta" digita o número (escuta global abaixo).
          setModoQuantidade(true);
          setQtyArmada(0);
          break;
        case 'modo-desconto':
          // F8 é consumido dentro do PainelTotais via atalho local.
          painelDescontoSignal.current += 1;
          break;
        case 'cancelar-item': {
          // F9: linha focada; sem foco explícito, cancela a última bipada.
          if (idLinhaFocada) cart.removerLinha(idLinhaFocada);
          else cart.removerUltimo();
          setIdLinhaFocada(null);
          break;
        }
        case 'finalizar-venda':
          if (cart.totalCentavos > 0) setSheetAberta(true);
          break;
        case 'focar-busca':
        case 'limpar-modos':
          setModoQuantidade(false);
          setQtyArmada(1);
          break;
      }
    },
    [cart, idLinhaFocada],
  );

  const { buscaRef } = usePdvAtalhos(aoAcao, !sheetAberta);

  // Sinal F8 -> PainelTotais (contador = dispara mesmo repetindo F8).
  const painelDescontoSignal = useRef(0);
  const [descontoAberto, setDescontoAberto] = useState(false);
  useEffect(() => {
    if (painelDescontoSignal.current > 0) setDescontoAberto(true);
  }, [painelDescontoSignal.current]);

  // ------------------------------------------------------------------
  // MODO QUANTIDADE: dígito solto (com modo armado) compõe a quantidade.
  // Enter sem item na busca confirma só a qty; qualquer add consome o modo.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!modoQuantidade || sheetAberta) return;
    const onDigito = (ev: globalThis.KeyboardEvent) => {
      if (/^[0-9]$/.test(ev.key)) {
        ev.preventDefault();
        setQtyArmada((q) => Math.min(999, (q === 0 ? 0 : q) * 10 + Number(ev.key)));
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        setModoQuantidade(false);
        setQtyArmada(1);
      } else if (ev.key === 'Enter') {
        // Confirma/encerra o modo; qty permanece armada p/ o próximo item.
        setModoQuantidade(false);
        buscaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onDigito);
    return () => window.removeEventListener('keydown', onDigito);
  }, [modoQuantidade, sheetAberta, buscaRef]);

  /** Adiciona consumindo a qty armada (F4) e devolve o foco à busca. */
  const adicionar = useCallback(
    (produto: Produto) => {
      cart.adicionarProduto(produto, Math.max(1, qtyArmada || 1));
      setQtyArmada(1);
      setModoQuantidade(false);
      buscaRef.current?.focus();
    },
    [cart, qtyArmada, buscaRef],
  );

  const confirmarVenda = useCallback(() => {
    onVendaConfirmada?.({
      totalCentavos: cart.totalCentavos,
      descontoCentavos: cart.descontoCentavos,
      pagamentos: cart.pagamentos,
    });
    cart.limpar();
    setSheetAberta(false);
    setIdLinhaFocada(null);
    buscaRef.current?.focus();
  }, [cart, onVendaConfirmada, buscaRef]);

  const saldoCalculado = useMemo(() => cart.saldoCentavos(), [cart]);

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: t.color.bg,
        color: t.color.text,
        fontFamily: t.font.sans,
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 340px',
        gridTemplateRows: 'auto 1fr',
        gap: 14,
      }}
    >
      {/* Banner do MODO QUANTIDADE — nunca um modo invisível */}
      {modoQuantidade && (
        <div
          role="status"
          style={{
            gridColumn: '1 / -1',
            padding: '8px 14px',
            border: `2px solid ${t.color.accent}`,
            borderRadius: t.radius.md,
            backgroundColor: t.color.surfaceAlt,
            color: t.color.accent,
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 0.4,
          }}
        >
          MODO QUANTIDADE (F4) — digite a quantidade e bipe o produto
          {qtyArmada > 0 ? ` · QTD: ${qtyArmada}` : ''} · Esc cancela
        </div>
      )}

      {/* ---------------- Linha 1: busca ocupa as 2 colunas ---------------- */}
      <div style={{ gridColumn: '1 / -1' }}>
        <BarraBuscaPdv
          produtos={resultados}
          buscando={conexao.tipo === 'carregando'}
          onBuscar={setTermo}
          onAdicionar={adicionar}
          buscaRef={buscaRef}
        />
      </div>

      {/* ---------------- Coluna esquerda: atalhos + cupom ---------------- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          minWidth: 0,
          overflowY: 'auto',
        }}
      >
        <section aria-label="Produtos frequentes" ref={gradeRef}>
          <GradeAtalhos produtos={resultados} onAdicionar={adicionar} />
        </section>

        <section aria-label="Cupom em edição" ref={cupomRef} style={{ flex: 1 }}>
          <ListaCupom
            linhas={cart.linhas}
            onIncrementar={cart.incrementar}
            onDecrementar={cart.decrementar}
            onRemover={(id) => {
              cart.removerLinha(id);
              setIdLinhaFocada(null);
            }}
            onFocarLinha={setIdLinhaFocada}
            idLinhaFocada={idLinhaFocada}
          />
        </section>
      </div>

      {/* ---------------- Coluna direita: totais SEM scroll ---------------- */}
      <div style={{ position: 'sticky', top: 16, alignSelf: 'start' }}>
        <PainelTotais
          subtotalCentavos={cart.subtotalCentavos}
          descontoCentavos={cart.descontoCentavos}
          onAplicarDesconto={cart.setDescontoCentavos}
          descontoExternoAberto={descontoAberto}
          onDescontoFechado={() => setDescontoAberto(false)}
          totalCentavos={cart.totalCentavos}
          totalItens={cart.totalItens}
          conexao={conexao}
          onFinalizar={() => setSheetAberta(true)}
          onSincronizar={() => void sincronizar()}
        />
      </div>

      <SheetPagamento
        aberto={sheetAberta}
        totalCentavos={cart.totalCentavos}
        pagamentos={cart.pagamentos}
        saldoCalculado={saldoCalculado}
        onRegistrarPagamento={cart.registrarPagamento}
        onConfirmar={confirmarVenda}
        onFechar={() => {
          setSheetAberta(false);
          buscaRef.current?.focus();
        }}
      />
    </main>
  );
}
