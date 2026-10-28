/**
 * Agenda `fn` para depois do primeiro paint (requestIdleCallback com fallback em setTimeout).
 * Usado só em trabalho de mount que não precisa estar pronto no primeiro frame.
 * Retorna função de cancelamento (seguro chamar após a execução).
 */
export function runWhenIdle(fn: () => void, timeoutMs = 1000): () => void {
  if (typeof window === "undefined") {
    fn();
    return () => undefined;
  }
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}
