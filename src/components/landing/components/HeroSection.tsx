/**
 * Hero — primeira dobra de conversão: proposta de valor do PDV + CTAs reais.
 */

'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { landingTheme as t, tabularNums } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
.nx-hero-primary { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease; }
.nx-hero-secondary { transition: border-color ${t.motion.fast} ease, background ${t.motion.fast} ease, transform ${t.motion.fast} ease; }
@media (hover: hover) {
  .nx-hero-primary:hover { box-shadow: ${t.shadow.ctaGlow}; transform: translateY(-1px); filter: brightness(1.06); }
  .nx-hero-secondary:hover { border-color: rgba(255,255,255,0.28) !important; background: rgba(255,255,255,0.06) !important; transform: translateY(-1px); }
}
@keyframes nx-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.nx-hero-chip { animation: nx-float 6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .nx-hero-chip { animation: none; } }
@media (max-width: 900px) {
  .nx-hero-grid { grid-template-columns: 1fr !important; text-align: center !important; }
  .nx-hero-actions { justify-content: center !important; }
  .nx-hero-mock { margin-top: 48px !important; }
}
@media (max-width: 760px) { .nx-hero-mock-inner { transform: none !important; } }
`;

const sectionStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  paddingTop: 'clamp(128px, 18vh, 176px)',
  paddingBottom: 80,
  background:
    'radial-gradient(1100px 540px at 50% -120px, rgba(37, 99, 235, 0.14) 0%, rgba(37, 99, 235, 0.05) 45%, transparent 72%)',
};

const container: CSSProperties = {
  maxWidth: t.layout.max,
  margin: '0 auto',
  padding: '0 24px',
};

const badge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  borderRadius: t.radius.full,
  border: `1px solid ${t.color.glassBorder}`,
  background: 'rgba(15, 23, 42, 0.6)',
  color: t.color.textBody,
  fontSize: 13,
  fontWeight: 500,
};

const mockCard: CSSProperties = {
  background: 'linear-gradient(180deg, #101828 0%, #0D1424 100%)',
  border: '1px solid rgba(255, 255, 255, 0.09)',
  borderRadius: 10,
  padding: '10px 12px',
  textAlign: 'left',
};

const CARRINHO = [
  { nome: 'Camiseta Básica M', qtd: 2, valor: 'R$ 79,80' },
  { nome: 'Boné Premium', qtd: 1, valor: 'R$ 49,90' },
];

export function HeroSection() {
  return (
    <section style={sectionStyle}>
      <style>{CSS}</style>
      <div style={container}>
        <div
          className="nx-hero-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 48,
            alignItems: 'center',
            textAlign: 'left',
          }}
        >
          <div>
            <Reveal>
              <div style={badge}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: t.radius.full,
                    background: t.color.accent,
                    display: 'inline-block',
                  }}
                  aria-hidden="true"
                />
                PDV, estoque e clientes em uma plataforma
              </div>
            </Reveal>

            <Reveal delay={80}>
              <h1
                style={{
                  margin: '24px 0 20px',
                  fontFamily: t.font.heading,
                  fontSize: 'clamp(32px, 4.8vw, 54px)',
                  fontWeight: 800,
                  lineHeight: 1.1,
                  letterSpacing: '-0.02em',
                  color: t.color.text,
                }}
              >
                Venda mais e controle sua loja com um{' '}
                <span
                  style={{
                    background: `linear-gradient(90deg, ${t.color.secondary}, ${t.color.accent})`,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  PDV profissional
                </span>
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p
                style={{
                  margin: '0 0 32px',
                  maxWidth: 520,
                  fontSize: 17,
                  lineHeight: 1.65,
                  color: t.color.textMuted,
                }}
              >
                O Nex Gestão Vendas reúne ponto de venda, estoque auditado e cadastro de clientes
                em uma plataforma simples — com operação offline e sincronização automática.
              </p>
            </Reveal>

            <Reveal delay={160}>
              <div
                className="nx-hero-actions"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}
              >
                <Link
                  href="/planos"
                  className="nx-hero-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: 52,
                    padding: '0 28px',
                    borderRadius: t.radius.md,
                    background: `linear-gradient(135deg, ${t.color.accent} 0%, #0EA371 100%)`,
                    color: t.color.accentText,
                    fontSize: 15,
                    fontWeight: 800,
                    fontFamily: t.font.heading,
                    textDecoration: 'none',
                  }}
                >
                  Começar agora
                </Link>
                <a
                  href="#recursos"
                  className="nx-hero-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: 52,
                    padding: '0 24px',
                    borderRadius: t.radius.md,
                    border: `1px solid rgba(255, 255, 255, 0.14)`,
                    color: t.color.text,
                    fontSize: 15,
                    fontWeight: 600,
                    textDecoration: 'none',
                    background: 'transparent',
                  }}
                >
                  Conhecer funcionalidades
                </a>
              </div>
              <p style={{ margin: '16px 0 0', fontSize: 13, color: t.color.textMuted }}>
                Planos para 1 loja até operação multi-loja · Veja opções em{' '}
                <Link href="/planos" style={{ color: t.color.accent, textDecoration: 'none', fontWeight: 600 }}>
                  /planos
                </Link>
              </p>
            </Reveal>
          </div>

          {/* Mockup PDV — CSS puro, sem screenshot fictício */}
          <Reveal delay={200}>
            <div className="nx-hero-mock" style={{ position: 'relative' }}>
              <div
                className="nx-hero-mock-inner"
                style={{
                  position: 'relative',
                  borderRadius: t.radius.lg,
                  border: '1px solid rgba(255, 255, 255, 0.10)',
                  boxShadow: t.shadow.heroGlow,
                  background: '#0D1322',
                  transform: 'perspective(1400px) rotateX(8deg) rotateY(-4deg)',
                  overflow: 'hidden',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, transparent 100%)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 16px',
                    borderBottom: `1px solid ${t.color.border}`,
                    background: 'rgba(15, 23, 42, 0.65)',
                  }}
                >
                  {['#F87171', '#FBBF24', '#34D399'].map((cor) => (
                    <span key={cor} style={{ width: 10, height: 10, borderRadius: t.radius.full, background: cor, opacity: 0.8 }} />
                  ))}
                  <span style={{ marginLeft: 8, fontSize: 12.5, color: t.color.textMuted }}>PDV · Caixa 01</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      fontWeight: 600,
                      color: t.color.accent,
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: t.radius.full,
                      padding: '3px 10px',
                    }}
                  >
                    Online
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12, padding: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: t.color.textMuted, marginBottom: 10 }}>
                      Carrinho
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {CARRINHO.map((item) => (
                        <div key={item.nome} style={mockCard}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.color.text }}>{item.nome}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: t.color.textMuted, ...tabularNums }}>
                            <span>Qtd: {item.qtd}</span>
                            <span style={{ fontWeight: 700, color: t.color.text }}>{item.valor}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={mockCard}>
                      <div style={{ fontSize: 11, color: t.color.textMuted }}>Total</div>
                      <div style={{ marginTop: 4, fontFamily: t.font.heading, fontSize: 22, fontWeight: 800, color: t.color.text, ...tabularNums }}>
                        R$ 129,70
                      </div>
                    </div>
                    <div
                      style={{
                        ...mockCard,
                        background: `linear-gradient(135deg, ${t.color.accent}22, ${t.color.secondary}18)`,
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        textAlign: 'center',
                        padding: '14px 12px',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.color.accent }}>Finalizar venda</div>
                      <div style={{ marginTop: 4, fontSize: 10.5, color: t.color.textMuted }}>F12 · Dinheiro · Pix</div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="nx-hero-chip"
                style={{
                  position: 'absolute',
                  top: -14,
                  right: 20,
                  zIndex: 4,
                  padding: '8px 14px',
                  borderRadius: t.radius.md,
                  background: 'rgba(15, 23, 42, 0.92)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  boxShadow: t.shadow.ctaAccentGlow,
                  fontSize: 12,
                  fontWeight: 700,
                  color: t.color.accent,
                }}
              >
                Funciona offline
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
