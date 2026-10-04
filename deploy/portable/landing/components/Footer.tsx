/**
 * Footer — institucional, legal e mapa do ecossistema (spec).
 * -----------------------------------------------------------------------------
 * - Divisor superior em hairline rgba(255,255,255,0.05) e tipografia
 *   secundária em slate-400 (#94A3B8) — exatamente o tom da spec.
 * - Links com sublinhado animado (mesma linguagem da navbar).
 * - StatusIndicator com ponto verde pulsante: "Todos os sistemas operacionais".
 * - CNPJ e links legais são PLACEHOLDER — ver PORTING.md.
 */

'use client';

import { landingTheme as t } from '../theme/landing-theme';

const CSS = `
.nx-foot-link { color: #94A3B8; text-decoration: none; font-size: 13.5px; line-height: 2.1; background-image: linear-gradient(90deg, #2563EB, #10B981); background-repeat: no-repeat; background-size: 0% 1.5px; background-position: 0 100%; transition: color 150ms ease, background-size 220ms ease; }
.nx-foot-link:hover, .nx-foot-link:focus-visible { color: #F1F5F9; background-size: 100% 1.5px; outline: none; }
@keyframes nx-foot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.nx-foot-dot { animation: nx-foot-pulse 2.2s ease-in-out infinite; }
@media (max-width: 900px) { .nx-foot-grid { grid-template-columns: 1fr 1fr !important; } }
@media (max-width: 560px) { .nx-foot-grid { grid-template-columns: 1fr !important; } }
`;

const COLUNAS: ReadonlyArray<{ titulo: string; links: ReadonlyArray<string> }> = [
  { titulo: 'Produto', links: ['Visão geral', 'Kanban comercial', 'WhatsApp & Follow-up', 'Relatórios e DRE', 'Preços'] },
  { titulo: 'Soluções', links: ['Varejo', 'Serviços', 'Indústria', 'Distribuidoras', 'Startups'] },
  { titulo: 'Recursos', links: ['Central de Ajuda', 'API & Webhooks', 'Status', 'Changelog', 'Comunidade'] },
  { titulo: 'Legal', links: ['Privacidade', 'Termos de uso', 'LGPD', 'Segurança', 'Cookies'] },
];

export function Footer() {
  const ano = new Date().getFullYear();

  return (
    <footer style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', padding: '56px 0 40px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        <div className="nx-foot-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 1fr)', gap: 32 }}>
          {/* BrandInfo */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <defs>
                  <linearGradient id="nx-foot-grad" x1="4" y1="28" x2="28" y2="4">
                    <stop offset="0%" stopColor={t.color.accent} />
                    <stop offset="100%" stopColor={t.color.secondary} />
                  </linearGradient>
                </defs>
                <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" stroke="url(#nx-foot-grad)" strokeWidth="1.5" opacity="0.55" />
                <path d="M9.5 23V9.5l13 13V9" stroke="url(#nx-foot-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ color: t.color.text, fontFamily: t.font.heading, fontSize: 17, fontWeight: 700 }}>NexGestão</span>
            </div>
            <p style={{ margin: '14px 0 0', maxWidth: 280, fontSize: 13, lineHeight: 1.65, color: t.color.textMuted }}>
              CRM e gestão de vendas para operações B2B que precisam de previsibilidade comercial.
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 12, color: t.color.textMuted }}>
              CNPJ 00.000.000/0001-00 · NexGestão Tecnologia Ltda.
            </p>
            <div
              style={{
                marginTop: 14,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderRadius: t.radius.full,
                border: `1px solid ${t.color.border}`,
                background: 'rgba(255,255,255,0.03)',
                fontSize: 11.5,
                fontWeight: 600,
                color: t.color.textMuted,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              Site protegido · SSL 256-bit
            </div>
          </div>

          {/* LinkColumns */}
          {COLUNAS.map((col) => (
            <nav key={col.titulo} aria-label={col.titulo}>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.color.text }}>
                {col.titulo}
              </div>
              <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }}>
                {col.links.map((link) => (
                  <li key={link}>
                    <a className="nx-foot-link" href="#">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* StatusIndicator + copyright */}
        <div
          style={{
            marginTop: 48,
            paddingTop: 24,
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <span style={{ fontSize: 12.5, color: t.color.textMuted }}>© {ano} NexGestão de Vendas. Todos os direitos reservados.</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: t.radius.full,
              border: '1px solid rgba(16, 185, 129, 0.3)',
              background: 'rgba(16, 185, 129, 0.08)',
              fontSize: 12,
              fontWeight: 600,
              color: t.color.accent,
            }}
          >
            <span className="nx-foot-dot" style={{ width: 8, height: 8, borderRadius: t.radius.full, background: t.color.accent }} aria-hidden="true" />
            Todos os sistemas operacionais
          </span>
        </div>
      </div>
    </footer>
  );
}
