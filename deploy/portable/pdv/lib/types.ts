/**
 * Contratos de dados do PDV — espelham EXATAMENTE as tabelas Supabase já
 * criadas em `supabase/migrations/20260925120000_hermes_chat_tables_rls.sql`:
 *
 *   products (id uuid, name text, sku text NULL, barcode text NULL,
 *             unit_price numeric(12,2) >= 0)
 *
 * REGRA: nenhum endpoint novo, nenhum campo inventado. A UI consome o schema
 * existente; totais são derivados no cliente apenas como *prévia* — o valor
 * fiscal final continua nascendo da camada de persistência/NFC-e (intocada).
 */

/** Linha de `public.products` (SELECT liberado p/ authenticated via RLS). */
export interface Produto {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** numeric(12,2) — chega como number via supabase-js. */
  unit_price: number;
}

/** Item do cupom em edição (estado de UI, nunca persistido direto). */
export interface LinhaCupom {
  produto: Produto;
  quantidade: number;
}

/** Formas de pagamento aceitas na Sheet ( mistas = várias entradas ). */
export type FormaPagamento = 'DINHEIRO' | 'DEBITO' | 'CREDITO' | 'PIX';

export interface Pagamento {
  forma: FormaPagamento;
  /** Valor em centavos (inteiros) — zero aritmética flutuante no caixa. */
  centavos: number;
}

/** Estado de conectividade do catálogo, exibido explicitamente na tela. */
export type EstadoConexao =
  | { tipo: 'online' }
  | { tipo: 'offline'; motivo: 'sem_supabase' | 'erro_rede' | 'erro_servidor'; pendentes: number }
  | { tipo: 'carregando' };
