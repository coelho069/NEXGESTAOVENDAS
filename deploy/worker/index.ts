/**
 * NexGestão de Vendas — Notification Email API (Cloudflare Worker)
 *
 * POST /           -> sends welcome_payment | receipt email
 * POST /validate   -> dry-run: validates payload + renders template, no email sent
 *
 * Security:  Authorization: Bearer <API_EMAIL_TOKEN> (constant-time compare)
 * Sender:    NexGestão de Vendas <welcome@nexgestaovendas.com.br>
 * Errors:    400 invalid payload · 401 bad/missing token · 405 method · 500 send failure
 */

/// <reference types="@cloudflare/workers-types" />

/** Bindings configured via `wrangler secret put` (see wrangler.toml). */
interface Env {
  /** Shared secret clients must present as `Authorization: Bearer <token>`. */
  API_EMAIL_TOKEN: string;
  /** Resend API key used to deliver the emails. */
  RESEND_API_KEY: string;
}

type EmailEventType = 'welcome_payment' | 'receipt';

interface EmailPayload {
  to: string;
  name: string;
  type: EmailEventType;
  data: {
    plan_name?: unknown;
    amount?: unknown;
    access_link?: unknown;
  };
}

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

/** Fields required per event type. */
const REQUIRED_DATA_FIELDS: Record<EmailEventType, readonly string[]> = {
  welcome_payment: ['plan_name', 'amount', 'access_link'],
  receipt: ['plan_name', 'amount'],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALLOWED_ORIGINS = ['https://nexgestaovendas.com.br', 'https://www.nexgestaovendas.com.br'];

/* ---------------------------------- env ---------------------------------- */

function getEnv(env: Env): { token: string; resendKey: string } | null {
  const token = env.API_EMAIL_TOKEN;
  const resendKey = env.RESEND_API_KEY;
  if (!token || !resendKey) return null;
  return { token, resendKey };
}

/* --------------------------------- auth ---------------------------------- */

/** Constant-time compare so response latency can't leak the token. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(request: Request, env: Env): boolean {
  const creds = getEnv(env);
  if (!creds) return false;
  const header = request.headers.get('Authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  return safeEqual(token, creds.token);
}

/* ------------------------------- validation ------------------------------ */

function validatePayload(raw: unknown): { payload: EmailPayload } | { error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;

  const to = body.to;
  if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) {
    return { error: '"to" is required and must be a valid email address.' };
  }

  const name = body.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 120) {
    return { error: '"name" is required (string, max 120 chars).' };
  }

  const type = body.type;
  if (type !== 'welcome_payment' && type !== 'receipt') {
    return { error: '"type" must be "welcome_payment" or "receipt".' };
  }

  if (body.data === null || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return { error: '"data" must be an object.' };
  }
  const data = body.data as EmailPayload['data'];

  for (const field of REQUIRED_DATA_FIELDS[type]) {
    if (data[field as keyof EmailPayload['data']] === undefined) {
      return { error: `"data.${field}" is required for type "${type}".` };
    }
  }

  if (data.amount !== undefined) {
    const n = typeof data.amount === 'number' ? data.amount : Number(data.amount);
    if (!Number.isFinite(n) || n < 0) {
      return { error: '"data.amount" must be a non-negative number (e.g. 97.90).' };
    }
  }

  if (data.access_link !== undefined) {
    if (typeof data.access_link !== 'string') {
      return { error: '"data.access_link" must be a string URL.' };
    }
    try {
      const url = new URL(data.access_link);
      if (url.protocol !== 'https:') {
        return { error: '"data.access_link" must use https://.' };
      }
    } catch {
      return { error: '"data.access_link" must be a valid absolute URL.' };
    }
  }

  return {
    payload: {
      to: to.trim(),
      name: name.trim(),
      type,
      data: { ...data, amount: typeof data.amount === 'number' ? data.amount : Number(data.amount) },
    },
  };
}

/* -------------------------------- templating ------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function brl(amount: number): string {
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const WRAPPER = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#111827;padding:24px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:bold;">NexGestão de Vendas</span>
        </td></tr>
        <tr><td style="padding:32px;">
          %BODY%
        </td></tr>
        <tr><td style="padding:16px 32px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5;">
            Você recebeu este e-mail porque criou uma conta na NexGestão de Vendas.<br>
            NexGestão de Vendas · Brasil
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const CTA = (link: string, label: string) => `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
            <tr><td style="background:#2563eb;border-radius:8px;">
              <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${label}</a>
            </td></tr>
          </table>`;

function renderTemplate(payload: EmailPayload): { subject: string; html: string } {
  const firstName = escapeHtml(payload.name.split(' ')[0]);
  const plan = escapeHtml(String(payload.data.plan_name ?? ''));
  const amount = brl(payload.data.amount as number);

  let subject: string;
  let body: string;

  if (payload.type === 'welcome_payment') {
    subject = `Bem-vindo à NexGestão de Vendas, ${firstName}!`;
    body = `
          <h1 style="margin:0 0 12px;color:#111827;font-size:22px;">Pagamento confirmado 🎉</h1>
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
            Olá, <strong>${firstName}</strong>! Seu pagamento foi aprovado e sua conta já está ativa.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 8px;">
            <tr><td style="padding:16px;">
              <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Plano</p>
              <p style="margin:0 0 12px;color:#111827;font-size:16px;font-weight:bold;">${plan}</p>
              <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Valor</p>
              <p style="margin:0;color:#111827;font-size:16px;font-weight:bold;">${amount}</p>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;color:#374151;font-size:15px;line-height:1.6;">
            Clique abaixo para acessar a plataforma com o e-mail <strong>${escapeHtml(payload.to)}</strong>:
          </p>
          ${CTA(String(payload.data.access_link), 'Acessar a plataforma')}`;
  } else {
    subject = `Recibo de compra — NexGestão de Vendas (${amount})`;
    body = `
          <h1 style="margin:0 0 12px;color:#111827;font-size:22px;">Recibo de compra</h1>
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
            Olá, <strong>${firstName}</strong>! Este é o recibo da sua compra.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 8px;">
            <tr><td style="padding:16px;">
              <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Produto</p>
              <p style="margin:0 0 12px;color:#111827;font-size:16px;font-weight:bold;">${plan}</p>
              <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Total pago</p>
              <p style="margin:0;color:#111827;font-size:16px;font-weight:bold;">${amount}</p>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
            Guarde este e-mail para seus registros. Em caso de dúvidas, basta responder esta mensagem.
          </p>`;
  }

  return { subject, html: WRAPPER.replace('%BODY%', body) };
}

/* ------------------------------ send (Resend) ----------------------------- */

async function sendEmail(env: Env, payload: EmailPayload): Promise<void> {
  const { subject, html } = renderTemplate(payload);
  const creds = getEnv(env)!;

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'NexGestão de Vendas <welcome@nexgestaovendas.com.br>',
        to: [payload.to],
        subject,
        html,
      }),
    });
  } catch {
    throw new Error('email_provider_unreachable');
  }

  if (!response.ok) {
    console.error('resend_error', { status: response.status, body: await response.text().catch(() => '') });
    throw new Error('email_send_failed');
  }
}

/* --------------------------------- router --------------------------------- */

const json = (data: unknown, status: number, request: Request): Response => {
  const response = Response.json(data, { status });
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
  return response;
};

const handler: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed. Use POST.' }, 405, request);
    }

    if (!isAuthorized(request, env)) {
      return json({ error: 'Unauthorized. Provide "Authorization: Bearer <token>".' }, 401, request);
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'Body must be valid JSON.' }, 400, request);
    }

    const result = validatePayload(raw);
    if ('error' in result) {
      return json({ error: result.error }, 400, request);
    }

    if (new URL(request.url).pathname === '/validate') {
      const { subject, html } = renderTemplate(result.payload);
      return json({ ok: true, dry_run: true, subject, html }, 200, request);
    }

    try {
      await sendEmail(env, result.payload);
    } catch (err) {
      console.error('send_failed', { type: result.payload.type, reason: err instanceof Error ? err.message : 'unknown' });
      return json({ error: 'Failed to send email. Please try again later.' }, 500, request);
    }

    return json({ ok: true, type: result.payload.type, to: result.payload.to }, 202, request);
  },
};

export default handler;
