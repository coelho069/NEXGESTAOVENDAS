/**
 * Prévia de planos — direciona para /planos sem alterar preços ou lógica comercial.
 */

'use client';

import Link from 'next/link';
import { landingTheme as t } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
.nx-plan-card { transition: transform ${t.motion.base} ease, box-shadow ${t.motion.base} ease, border-color ${t.motion.base} ease; }
@media (hover: hover) {
  .nx-plan-card:hover { transform: translateY(-2px); box-shadow: ${t.shadow.card}; }
  .nx-plan-popular:hover { box-shadow: 0 24px 48px -16px rgba(16, 185, 129, 0.35); }
}
.nx-plan-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease; }
@media (hover: hover) { .nx-plan-cta:hover { box-shadow: ${t.shadow.ctaAccentGlow}; transform: translateY(-1px); } }
@media (max-width: 800px) { .nx-plan-grid { grid-template-columns: 1fr !important; } }
`;

const TIERS = [
  {
    name: 'Essencial',
    desc: 'PDV, estoque e clientes para 1 loja.',
    features: ['PDV offline-first', 'Estoque auditado', '1 loja'],
    popular: false,
  },
  {
    name: 'Crescimento',
    desc: 'Para quem expande: até 3 lojas com recursos avançados.',
    features: ['Tudo do Essencial', 'Hotkeys de caixa', 'StockMap', 'Até 3 lojas'],
    popular: true,
  },
  {
    name: 'Escala',
    desc: 'Operação completa com dashboard e lojas ilimitadas.',
    features: ['Tudo do Crescimento', 'Dashboard e relatórios', 'Importação CSV', 'Lojas ilimitadas'],
    popular: false,
  },
];

export function PlansPreview() {
  return (
    <section id="planos" style={{ padding: '48px 0 80px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2
              style={{
                margin: '0 0 12px',
                fontFamily: t.font.heading,
                fontSize: 'clamp(26px, 3.4vw, 38px)',
                fontWeight: 800,
                color: t.color.text,
              }}
            >
              Planos para cada fase do seu negócio
            </h2>
            <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
              Valores e condições atualizados na página de planos. Escolha o tier e assine pelo fluxo existente.
            </p>
          </div>
        </Reveal>

        <div className="nx-plan-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {TIERS.map((tier, i) => (
            <Reveal key={tier.name} delay={i * 60}>
              <article
                className={`nx-plan-card${tier.popular ? ' nx-plan-popular' : ''}`}
                style={{
                  position: 'relative',
                  borderRadius: t.radius.lg,
                  border: tier.popular ? '1px solid rgba(16, 185, 129, 0.45)' : `1px solid ${t.color.border}`,
                  background: tier.popular
                    ? 'linear-gradient(180deg, rgba(16, 185, 129, 0.1) 0%, rgba(15, 23, 42, 0.85) 100%)'
                    : 'rgba(30, 41, 59, 0.45)',
                  padding: 28,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {tier.popular && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -12,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      padding: '4px 14px',
                      borderRadius: t.radius.full,
                      background: t.color.accent,
                      color: t.color.accentText,
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Mais popular
                  </span>
                )}
                <h3 style={{ margin: 0, fontFamily: t.font.heading, fontSize: 18, fontWeight: 700, color: tier.popular ? t.color.accent : t.color.text }}>
                  {tier.name}
                </h3>
                <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.55, color: t.color.textMuted }}>{tier.desc}</p>
                <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, flex: 1 }}>
                  {tier.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 13.5, color: t.color.textBody }}>
                      <span style={{ color: t.color.accent, fontWeight: 700 }} aria-hidden="true">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 36 }}>
            <Link
              href="/planos"
              className="nx-plan-cta"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 52,
                padding: '0 32px',
                borderRadius: t.radius.md,
                background: `linear-gradient(135deg, ${t.color.accent} 0%, #0EA371 100%)`,
                color: t.color.accentText,
                fontSize: 15,
                fontWeight: 800,
                fontFamily: t.font.heading,
                textDecoration: 'none',
              }}
            >
              Ver planos e preços →
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
