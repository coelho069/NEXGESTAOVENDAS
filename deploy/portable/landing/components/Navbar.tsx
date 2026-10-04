/**
 * Navbar — navegação fixa flutuante (spec: navbar "atrito zero").
 * -----------------------------------------------------------------------------
 * - Glassmorphism fosco exato da spec: blur(16px) + rgba(15,23,42,0.75) +
 *   border-bottom 1px rgba(255,255,255,0.08).
 * - Links com sublinhado animado por gradiente (mesma linguagem do footer).
 * - Em telas < 1000px os links somem (a rota real de Preços/Cases continua
 *   acessível pelos CTAs e pelo rodapé).
 */

'use client';

import { landingTheme as t } from '../theme/landing-theme';

const LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Recursos', href: '#recursos' },
  { label: 'Soluções por Segmento', href: '#recursos' },
  { label: 'Integrações', href: '#recursos' },
  { label: 'Preços', href: '#roi' },
  { label: 'Cases', href: '#cases' },
];

const CSS = `
.nx-nav-link { position: relative; color: #CBD5E1; text-decoration: none; font-size: 14px; font-weight: 500; white-space: nowrap; transition: color ${t.motion.fast} ease; }
.nx-nav-link::after { content: ''; position: absolute; left: 0; right: 100%; bottom: -6px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, ${t.color.secondary}, ${t.color.accent}); transition: right ${t.motion.base} ease; }
.nx-nav-link:hover, .nx-nav-link:focus-visible { color: #F8FAFC; outline: none; }
.nx-nav-link:hover::after, .nx-nav-link:focus-visible::after { right: 0; }
.nx-nav-ghost { transition: border-color ${t.motion.fast} ease, background ${t.motion.fast} ease; }
@media (hover: hover) { .nx-nav-ghost:hover { border-color: rgba(255,255,255,0.28) !important; background: rgba(255,255,255,0.06) !important; } }
.nx-nav-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease; }
@media (hover: hover) { .nx-nav-cta:hover { box-shadow: ${t.shadow.ctaGlow}; transform: translateY(-1px); } }
@media (max-width: 1000px) { .nx-nav-links { display: none; } }
@media (max-width: 620px) { .nx-nav-ghost { display: none; } }
`;

/** Marca geométrica vetorial: "N" em traço contínuo com gradiente da marca. */
function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="nx-brand-grad" x1="4" y1="28" x2="28" y2="4">
          <stop offset="0%" stopColor={t.color.accent} />
          <stop offset="100%" stopColor={t.color.secondary} />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" stroke="url(#nx-brand-grad)" strokeWidth="1.5" opacity="0.55" />
      <path d="M9.5 23V9.5l13 13V9" stroke="url(#nx-brand-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Navbar() {
  return (
    <>
      <style>{CSS}</style>
      <header
        style={{
          position: 'fixed',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          width: `min(${t.layout.max}, calc(100% - 24px))`,
          zIndex: 1000,
        }}
      >
        <nav
          aria-label="Navegação principal"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '10px 14px 10px 20px',
            background: t.color.glassBg,
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: `1px solid ${t.color.glassBorder}`,
            borderBottom: `1px solid ${t.color.glassBorder}`,
            borderRadius: t.radius.lg,
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
          }}
        >
          {/* BrandLogo */}
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }} aria-label="NexGestão — início">
            <BrandMark />
            <span style={{ color: t.color.text, fontFamily: t.font.heading, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
              NexGestão
            </span>
          </a>

          {/* NavigationLinks */}
          <div className="nx-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            {LINKS.map((link) => (
              <a key={link.label} className="nx-nav-link" href={link.href}>
                {link.label}
              </a>
            ))}
          </div>

          {/* CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a
              className="nx-nav-ghost"
              href="#comecar"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 40,
                padding: '0 16px',
                borderRadius: t.radius.md,
                border: `1px solid rgba(255, 255, 255, 0.14)`,
                color: t.color.text,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                background: 'transparent',
              }}
            >
              Entrar na Conta
            </a>
            <a
              className="nx-nav-cta"
              href="#comecar"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 40,
                padding: '0 18px',
                borderRadius: t.radius.md,
                background: `linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 100%)`,
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                border: 'none',
              }}
            >
              Testar Gratuitamente por 14 Dias
            </a>
          </div>
        </nav>
      </header>
    </>
  );
}
