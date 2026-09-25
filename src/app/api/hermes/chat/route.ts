/**
 * Route handler do Chat do Hermes (NEX) — Next.js App Router.
 * Recebe a mensagem do widget, chama o Grok via xAI API e devolve { reply }.
 *
 * Variáveis de ambiente:
 *   XAI_API_KEY  — chave da API da xAI (obrigatória)
 *   HERMES_MODEL — opcional; default 'grok-4-fast-non-reasoning' (baixa latência p/ PDV)
 *
 * Resiliência (padrão NEX): timeouts + fallback determinístico; falha externa
 * nunca derruba a rota — devolve JSON estruturado com HTTP 502.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XAI_URL = 'https://api.x.ai/v1/chat/completions';

// Persona HERMES (mesma do ~/.grok/hermes-system-prompt.txt, condensada p/ servidor)
const HERMES_SYSTEM_PROMPT = [
  'Você é o HERMES, Secretário do NEX Gestão Vendas — Senior Fullstack Engineer & UI/UX Specialist.',
  'PROTOCOLO DE RESPOSTA (obrigatório): 🛠️ DIAGNÓSTICO -> ✅ SOLUÇÃO -> ⚠️ ALERTA. Tom pragmático e técnico.',
  'STACK: React.js + Tailwind CSS + lucide-react (hooks nativos); Supabase (PostgreSQL, Auth, Edge Functions Deno).',
  'FORMATO: respostas curtas e acionáveis para operador de caixa; código completo quando pedir código; try/catch em APIs.',
  'INSTRUÇÕES: priorize usabilidade de PDV (botões grandes, atalhos); sugira RLS ao tocar em objetos de banco.',
].join('\n');

// Fallback offline — mesmo texto do widget, mantém a UX consistente
const FALLBACK_REPLY =
  '⚠️ Não consegui falar com o HERMES agora. Tente novamente em instantes.';

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function jsonError(status: number, error: string, detail?: string) {
  return Response.json(
    { ok: false, error, ...(detail ? { detail } : {}) },
    { status },
  );
}

// Aborta chamadas externas em 12s — operador de caixa não pode ficar esperando
async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. Validação de entrada — 400 antes de gastar token
  let message: unknown;
  try {
    const body = (await request.json()) as { message?: unknown };
    message = body?.message;
  } catch {
    return jsonError(400, 'invalid_json', 'Corpo da requisição deve ser JSON válido.');
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    return jsonError(400, 'invalid_message', 'Campo "message" é obrigatório.');
  }
  if (message.length > 2000) {
    return jsonError(400, 'message_too_long', 'Mensagem excede 2000 caracteres.');
  }

  // 2. Chamada externa com try/catch completo
  try {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      // 500 configuracional, mas sem estourar exceção — JSON estruturado
      return jsonError(500, 'missing_api_key', 'Defina XAI_API_KEY no ambiente do servidor.');
    }

    const res = await fetchWithTimeout(
      XAI_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.HERMES_MODEL ?? 'grok-4-fast-non-reasoning',
          messages: [
            { role: 'system', content: HERMES_SYSTEM_PROMPT },
            { role: 'user', content: message },
          ],
        }),
      },
      12_000,
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => undefined);
      // Não vaza a resposta bruta do provedor ao cliente
      console.error('xAI respondeu com erro:', res.status, detail?.slice(0, 300));
      return jsonError(502, 'upstream_error', `xAI HTTP ${res.status}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      console.error('xAI retornou resposta sem conteúdo');
      return jsonError(502, 'empty_reply', 'xAI não retornou conteúdo.');
    }

    return Response.json({ ok: true, reply });
  } catch (err) {
    // AbortError = timeout; demais = rede/DNS. Mesma resposta, sem detalhes internos.
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error('Falha na rota do chat do Hermes:', err);
    return jsonError(
      502,
      isTimeout ? 'upstream_timeout' : 'network_error',
      FALLBACK_REPLY,
    );
  }
}
