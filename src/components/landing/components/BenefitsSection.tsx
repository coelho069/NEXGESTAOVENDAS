/**
 * Benefícios reais para o comerciante — sem métricas inventadas.
 */

'use client';

import { LANDING_BENEFITS } from '../data/landing-content';
import { landingTheme as t } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
.nx-benefit-card { transition: transform ${t.motion.base} ease, box-shadow ${t.motion.base} ease, border-color ${t.motion.base} ease; }
@media (hover: hover) {
  .nx-benefit-card:hover { transform: translateY(-3px); border-color: rgba(16, 185, 129, 0.3) !important; box-shadow: ${t.shadow.card}; }
}
@media (max-width: 720px) { .nx-benefit-grid { grid-template-columns: 1fr !important; } }
`;

export function BenefitsSection() {
  return (
    <section id="beneficios" style={{ padding: '48px 0 80px' }}>
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
              Por que escolher o Nex Gestão Vendas
            </h2>
            <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
              Vantagens práticas para quem opera loja física ou multi-loja no dia a dia.
            </p>
          </div>
        </Reveal>

        <div
          className="nx-benefit-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}
        >
          {LANDING_BENEFITS.map((b, i) => (
            <Reveal key={b.title} delay={i * 50}>
              <article
                className="nx-benefit-card"
                style={{
                  borderRadius: t.radius.lg,
                  border: `1px solid ${t.color.border}`,
                  background: 'rgba(30, 41, 59, 0.45)',
                  padding: 28,
                  textAlign: 'left',
                  height: '100%',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                    color: t.color.accent,
                    fontFamily: t.font.heading,
                    fontWeight: 800,
                    fontSize: 16,
                  }}
                  aria-hidden="true"
                >
                  {i + 1}
                </div>
                <h3 style={{ margin: '0 0 8px', fontFamily: t.font.heading, fontSize: 17, fontWeight: 700, color: t.color.text }}>
                  {b.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: t.color.textMuted }}>{b.description}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
