/**
 * Navbar — navegação fixa com menu mobile e CTAs reais.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrandMark } from './BrandMark';
import { landingTheme as t } from '../theme/landing-theme';

export type NavbarLink = { label: string; href: string };

const DEFAULT_LINKS: ReadonlyArray<NavbarLink> = [
  { label: 'Recursos', href: '#recursos' },
  { label: 'Benefícios', href: '#beneficios' },
  { label: 'Planos', href: '#planos' },
  { label: 'FAQ', href: '#faq' },
];

export type NavbarProps = {
  links?: ReadonlyArray<NavbarLink>;
  brandLabel?: string;
  loginLabel?: string;
  loginHref?: string;
  primaryCta?: { label: string; href: string };
};

const CSS = `
.nx-nav-link { position: relative; color: #CBD5E1; text-decoration: none; font-size: 14px; font-weight: 500; white-space: nowrap; transition: color ${t.motion.fast} ease; }
.nx-nav-link::after { content: ''; position: absolute; left: 0; right: 100%; bottom: -6px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, ${t.color.secondary}, ${t.color.accent}); transition: right ${t.motion.base} ease; }
.nx-nav-link:hover, .nx-nav-link:focus-visible { color: #F8FAFC; outline: none; }
.nx-nav-link:hover::after, .nx-nav-link:focus-visible::after { right: 0; }
.nx-nav-ghost { transition: border-color ${t.motion.fast} ease, background ${t.motion.fast} ease; }
@media (hover: hover) { .nx-nav-ghost:hover { border-color: rgba(255,255,255,0.28) !important; background: rgba(255,255,255,0.06) !important; } }
.nx-nav-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease; }
@media (hover: hover) { .nx-nav-cta:hover { box-shadow: ${t.shadow.ctaGlow}; transform: translateY(-1px); } }
@media (max-width: 900px) { .nx-nav-links { display: none !important; } .nx-nav-menu-btn { display: inline-flex !important; } }
@media (min-width: 901px) { .nx-nav-menu-btn { display: none !important; } .nx-nav-mobile { display: none !important; } }
@media (max-width: 620px) { .nx-nav-ghost { display: none !important; } }
`;

export function Navbar({
  links = DEFAULT_LINKS,
  brandLabel = 'NexGestão',
  loginLabel = 'Entrar na Conta',
  loginHref = '/login',
  primaryCta = { label: 'Testar Gratuitamente por 14 Dias', href: '/planos' },
}: NavbarProps = {}) {
  const [menuOpen, setMenuOpen] = useState(false);

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
            borderRadius: t.radius.lg,
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
          }}
        >
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }} aria-label="NexGestão — início">
            <BrandMark />
            <span style={{ color: t.color.text, fontFamily: t.font.heading, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
              {brandLabel}
            </span>
          </Link>

          <div className="nx-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            {links.map((link) => (
              <a key={link.label} className="nx-nav-link" href={link.href}>
                {link.label}
              </a>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a
              className="nx-nav-ghost"
              href={loginHref}
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
              {loginLabel}
            </a>
            <a
              className="nx-nav-cta"
              href={primaryCta.href}
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
              {primaryCta.label}
            </a>
            <button
              type="button"
              className="nx-nav-menu-btn"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
              style={{
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: t.radius.md,
                border: `1px solid rgba(255, 255, 255, 0.14)`,
                background: 'transparent',
                color: t.color.text,
                cursor: 'pointer',
              }}
            >
              {menuOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
          </div>
        </nav>

        {menuOpen && (
          <div
            className="nx-nav-mobile"
            style={{
              marginTop: 8,
              padding: 12,
              borderRadius: t.radius.lg,
              border: `1px solid ${t.color.glassBorder}`,
              background: t.color.glassBg,
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
          >
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'block',
                  padding: '10px 12px',
                  borderRadius: t.radius.md,
                  color: t.color.textBody,
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {link.label}
              </a>
            ))}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.color.border}` }}>
              <a
                href={loginHref}
                onClick={() => setMenuOpen(false)}
                style={{ display: 'block', padding: '10px 12px', color: t.color.text, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}
              >
                {loginLabel}
              </a>
              <a
                href={primaryCta.href}
                onClick={() => setMenuOpen(false)}
                style={{ display: 'block', padding: '10px 12px', marginTop: 4, color: t.color.accent, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}
              >
                {primaryCta.label}
              </a>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
