/**
 * Footer — links reais onde disponíveis, sem dados fictícios.
 */

'use client';

import Link from 'next/link';
import { landingTheme as t } from '../theme/landing-theme';

const CSS = `
.nx-foot-link { color: #94A3B8; text-decoration: none; font-size: 13.5px; line-height: 2.1; background-image: linear-gradient(90deg, #2563EB, #10B981); background-repeat: no-repeat; background-size: 0% 1.5px; background-position: 0 100%; transition: color 150ms ease, background-size 220ms ease; }
.nx-foot-link:hover, .nx-foot-link:focus-visible { color: #F1F5F9; background-size: 100% 1.5px; outline: none; }
@keyframes nx-foot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.nx-foot-dot { animation: nx-foot-pulse 2.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .nx-foot-dot { animation: none; } }
@media (max-width: 900px) { .nx-foot-grid { grid-template-columns: 1fr 1fr !important; } }
@media (max-width: 560px) { .nx-foot-grid { grid-template-columns: 1fr !important; } }
`;

type FootLink = { label: string; href: string };

const COLUNAS: ReadonlyArray<{ titulo: string; links: readonly FootLink[] }> = [
  {
    titulo: 'Produto',
    links: [
      { label: 'Recursos', href: '#recursos' },
      { label: 'Demonstração', href: '#demo' },
      { label: 'Planos', href: '/planos' },
      { label: 'Entrar', href: '/login' },
    ],
  },
  {
    titulo: 'Suporte',
    links: [
      { label: 'FAQ', href: '#faq' },
      { label: 'Planos e assinatura', href: '/planos' },
    ],
  },
  {
    titulo: 'Legal',
    links: [{ label: 'Política de reembolso', href: '/politica-de-reembolso' }],
  },
];

export function Footer() {
  const ano = new Date().getFullYear();

  return (
    <footer role="contentinfo" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', padding: '56px 0 40px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        <div className="nx-foot-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(3, 1fr)', gap: 32 }}>
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
            <p style={{ margin: '14px 0 0', maxWidth: 300, fontSize: 13, lineHeight: 1.65, color: t.color.textMuted }}>
              PDV, estoque e gestão comercial para varejo brasileiro — operação offline-first com sincronização na nuvem.
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
              Site protegido · SSL
            </div>
          </div>

          {COLUNAS.map((col) => (
            <nav key={col.titulo} aria-label={col.titulo}>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.color.text }}>
                {col.titulo}
              </div>
              <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }}>
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith('/') ? (
                      <Link className="nx-foot-link" href={link.href}>{link.label}</Link>
                    ) : (
                      <a className="nx-foot-link" href={link.href}>{link.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

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
          <span style={{ fontSize: 12.5, color: t.color.textMuted }}>
            © {ano} Nex Gestão Vendas. Todos os direitos reservados.
          </span>
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
            Plataforma em operação
          </span>
        </div>
      </div>
    </footer>
  );
}
