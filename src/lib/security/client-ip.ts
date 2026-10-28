/**
 * IP do cliente para limites por IP.
 *
 * Confia em X-Forwarded-For somente com TRUST_PROXY=1, que declara um proxy à
 * frente da aplicação que ACRESCENTA o IP de quem conectou ao fim da lista
 * (`proxy_add_x_forwarded_for`, como em deploy/nginx.conf.example). Só o último
 * valor vem do proxy; os anteriores vêm do cliente e podem ser forjados, por isso
 * o primeiro valor nunca é usado.
 *
 * X-Real-IP não é lido: nenhuma configuração do repositório define esse cabeçalho.
 */
const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

export function trustedClientIp(headers: Headers): string | null {
  if (process.env.TRUST_PROXY !== "1") return null;

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  const appended = hops[hops.length - 1];
  return appended && IP_LIKE.test(appended) ? appended : null;
}
