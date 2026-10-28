/** Nome exibido da loja (cabeçalho do PDV e recibo). */
export const STORE_NAME_MIN_LENGTH = 2;
export const STORE_NAME_MAX_LENGTH = 80;

/** Remove espaços das pontas e colapsa espaços repetidos no meio. */
export function normalizeStoreName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isValidStoreName(value: string): boolean {
  const length = normalizeStoreName(value).length;
  return length >= STORE_NAME_MIN_LENGTH && length <= STORE_NAME_MAX_LENGTH;
}
