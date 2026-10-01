/**
 * Dinheiro em centavos — SEMPRE inteiros.
 * -----------------------------------------------------------------------------
 * UX/confiabilidade: `0.1 + 0.2 !== 0.3`. Numa tela de PDV isso vira um centavo
 * errado no troco. Toda soma/multiplicação do cupom passa por aqui.
 * Cálculos FISCAIS (NFC-e/SEFAZ) permanecem no backend — isto é só a prévia.
 */

export function paraCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function deCentavos(centavos: number): number {
  return centavos / 100;
}

/** Soma de linhas: `Math.round` protege contra numeric(12,2) com ruído binário. */
export function totalLinhaCentavos(unitPrice: number, quantidade: number): number {
  return paraCentavos(unitPrice) * Math.max(0, Math.trunc(quantidade));
}

export function somaCentavos(valores: readonly number[]): number {
  return valores.reduce((acc, v) => acc + v, 0);
}

/** R$ 1.234,56 — formato de balcão, agrupa milhares, vírgula decimal. */
export function formatarBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarCentavos(centavos: number): string {
  return formatarBRL(deCentavos(centavos));
}

/**
 * Entrada estilo caixa registradora: dígitos = centavos da direita p/ esquerda.
 * "499" -> R$ 4,99 · "123456" -> R$ 1.234,56. Elimina erro de vírgula/ponto.
 */
export function centavosDeDigitos(digitos: string): number {
  const so = digitos.replace(/\D/g, '').slice(0, 9); // teto: R$ 9.999.999,99
  return so === '' ? 0 : parseInt(so, 10);
}

/** Normaliza para busca: sem acento, minúsculo — "CAFE" acha "Café". */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
