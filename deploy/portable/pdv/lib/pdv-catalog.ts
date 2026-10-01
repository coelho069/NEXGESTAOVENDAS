/**
 * Camada de dados do PDV — Supabase ao vivo com fallback offline.
 * -----------------------------------------------------------------------------
 * CONTRATO: usa EXATAMENTE o schema/RLS existentes.
 *   - SELECT em public.products  (policy: products_select_authenticated)
 *
 * Estado offline é EXPLÍCITO (Definition of Done): o operador vê "OFFLINE · N
 * pendentes" na tela. O catálogo carregado fica em cache local (module scope)
 * e serve as buscas mesmo sem rede — o PDV nunca fica "cego".
 *
 * PROIBIDO: inventar endpoints. Toda leitura vem da tabela `products` via
 * supabase-js; escrita fica na camada de persistência fiscal existente.
 */

import type { Produto } from './types';
import { normalizar } from './money';

/**
 * Cliente Supabase injetado — inverte a dependência p/ o projeto real fornecer
 * a instância criada com as credenciais de lá. Aqui definimos só a forma
 * (interface estrutural) que usamos: `.from().select().or()/.limit()`.
 */
export interface SupabaseLike {
  from(table: 'products'): {
    select(columns: string): {
      or(query: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

/** Cache em memória: sobrevive a quedas de rede durante o turno. */
let cache: Produto[] = [];
let ultimaSincronizacao = 0;
const TTL_MS = 60_000; // re-sincroniza no máx. 1x/min mesmo em burst de bips

export function catalogoEmCache(): readonly Produto[] {
  return cache;
}

export function estaStale(): boolean {
  return Date.now() - ultimaSincronizacao > TTL_MS;
}

export type ResultadoCatalogo =
  | { ok: true; produtos: Produto[]; fonte: 'rede' | 'cache' }
  | { ok: false; motivo: 'sem_supabase' | 'erro_rede' | 'erro_servidor'; pendentes: number };

/**
 * Busca produtos por termo (nome/SKU/código de barras) com fallback:
 *   1. Supabase `ilike` nos 3 campos (consulta à policy SELECT existente);
 *   2. se rede/Supabase falhar -> busca no cache local carregado por último.
 *
 * Código de barras bipado costuma vir com Enter/sufixo — o chamador normaliza.
 */
export async function buscarProdutos(
  termo: string,
  cliente: SupabaseLike | null,
): Promise<ResultadoCatalogo> {
  const termoLimpo = termo.trim();
  if (!cliente) {
    return { ok: false, motivo: 'sem_supabase', pendentes: cache.length };
  }

  // Termo vazio = "top frequências" — cache é suficiente e instantâneo.
  if (termoLimpo === '') {
    if (cache.length > 0) return { ok: true, produtos: cache.slice(0, 24), fonte: 'cache' };
  }

  const padrao = `%${termoLimpo.replace(/[%_,()]/g, '')}%`;
  try {
    const { data, error } = await cliente
      .from('products')
      .select('id, name, sku, barcode, unit_price')
      .or(`name.ilike.${padrao},sku.ilike.${padrao},barcode.eq.${termoLimpo}`);

    if (error) return { ok: false, motivo: 'erro_servidor', pendentes: cache.length };

    const produtos = (data ?? []) as Produto[];
    if (produtos.length > 0) {
      cache = produtos;
      ultimaSincronizacao = Date.now();
      return { ok: true, produtos, fonte: 'rede' };
    }

    // Rede OK mas zero resultados -> tenta cache p/ tolerar digitação parcial.
    if (cache.length > 0) {
      return { ok: true, produtos: filtrarCache(termoLimpo), fonte: 'cache' };
    }
    return { ok: true, produtos: [], fonte: 'rede' };
  } catch {
    // fetch/DNS/timeout — cai no cache; a tela mostra badge OFFLINE.
    return { ok: false, motivo: 'erro_rede', pendentes: cache.length };
  }
}

/** Filtro local acento-agnóstico sobre o cache ("CAFE" acha "Café"). */
function filtrarCache(termo: string): Produto[] {
  const alvo = normalizar(termo);
  return cache
    .filter((p) => {
      const campos = normalizar([p.name, p.sku ?? '', p.barcode ?? ''].join(' '));
      return campos.includes(alvo);
    })
    .slice(0, 24);
}

/**
 * Pré-carrega o catálogo inteiro p/ a GradeAtalhos e o fallback.
 * Lê a mesma tabela/policy — nenhum endpoint novo.
 */
export async function carregarCatalogo(
  cliente: SupabaseLike | null,
  limite = 500,
): Promise<ResultadoCatalogo> {
  if (!cliente) return { ok: false, motivo: 'sem_supabase', pendentes: cache.length };

  try {
    const { data, error } = await cliente
      .from('products')
      .select('id, name, sku, barcode, unit_price')
      .limit(limite);

    if (error) return { ok: false, motivo: 'erro_servidor', pendentes: cache.length };

    const produtos = (data ?? []) as Produto[];
    cache = produtos;
    ultimaSincronizacao = Date.now();
    return { ok: true, produtos, fonte: 'rede' };
  } catch {
    return { ok: false, motivo: 'erro_rede', pendentes: cache.length };
  }
}

/**
 * Fallback determinístico para o caixa nunca ver tela vazia: os 12 produtos do
 * seed `20260925140000_hermes_chat_seed_products.sql`, usados APENAS quando
 * Supabase é inacessível (offline + cache vazio, ex.: primeira execução).
 */
export const SEED_OFFLINE: Produto[] = [
  { id: 'seed-caf-500', name: 'Café Torrado 500g',       sku: 'CAF-500', barcode: '7890000000011', unit_price: 19.9 },
  { id: 'seed-lei-001', name: 'Leite Integral 1L',       sku: 'LEI-001', barcode: '7890000000028', unit_price: 5.49 },
  { id: 'seed-acu-1kg', name: 'Açúcar Refinado 1kg',     sku: 'ACU-1KG', barcode: '7890000000035', unit_price: 4.99 },
  { id: 'seed-arz-5kg', name: 'Arroz Branco 5kg',        sku: 'ARZ-5KG', barcode: '7890000000042', unit_price: 27.9 },
  { id: 'seed-fej-1kg', name: 'Feijão Carioca 1kg',      sku: 'FEJ-1KG', barcode: '7890000000059', unit_price: 8.99 },
  { id: 'seed-ole-900', name: 'Óleo de Soja 900ml',      sku: 'OLE-900', barcode: '7890000000066', unit_price: 7.29 },
  { id: 'seed-mac-500', name: 'Macarrão Espaguete 500g', sku: 'MAC-500', barcode: '7890000000073', unit_price: 4.49 },
  { id: 'seed-pao-500', name: 'Pão de Forma 500g',       sku: 'PAO-500', barcode: '7890000000080', unit_price: 6.99 },
  { id: 'seed-bis-cdt', name: 'Biscoito Recheado Choc.', sku: 'BIS-CDT', barcode: '7890000000097', unit_price: 3.29 },
  { id: 'seed-ref-2lt', name: 'Refrigerante Cola 2L',    sku: 'REF-2LT', barcode: '7890000000103', unit_price: 9.99 },
  { id: 'seed-sab-500', name: 'Detergente Neutro 500ml', sku: 'SAB-500', barcode: '7890000000110', unit_price: 2.89 },
  { id: 'seed-pap-12',  name: 'Papel Higiênico 12 rolos', sku: 'PAP-12',  barcode: '7890000000127', unit_price: 21.9 },
];
