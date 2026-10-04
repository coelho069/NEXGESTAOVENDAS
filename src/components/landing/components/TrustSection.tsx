/**
 * Prova de confiança — apenas elementos verificáveis, sem depoimentos inventados.
 */

'use client';

import { TRUST_ITEMS } from '../data/landing-content';
import { landingTheme as t } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
.nx-trust-card { transition: transform ${t.motion.base} ease, border-color ${t.motion.base} ease; }
@media (hover: hover) {
  .nx-trust-card:hover { transform: translateY(-2px); border-color: rgba(16, 185, 129, 0.3) !important; }
}
@media (max-width: 720px) { .nx-trust-grid { grid-template-columns: 1fr !important; } }
`;

export function TrustSection() {
  return (
    <section id="confianca" style={{ padding: '48px 0 80px' }}>
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
              Construído para operação real de varejo
            </h2>
            <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
              Segurança, resiliência e suporte integrados à plataforma.
            </p>
          </div>
        </Reveal>

        <div className="nx-trust-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {TRUST_ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={i * 50}>
              <div
                className="nx-trust-card"
                style={{
                  borderRadius: t.radius.lg,
                  border: `1px solid ${t.color.border}`,
                  background: 'rgba(15, 23, 42, 0.55)',
                  padding: 28,
                  textAlign: 'left',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'rgba(37, 99, 235, 0.14)',
                    border: '1px solid rgba(37, 99, 235, 0.3)',
                    color: '#93C5FD',
                    marginBottom: 14,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </span>
                <h3 style={{ margin: '0 0 8px', fontFamily: t.font.heading, fontSize: 16, fontWeight: 700, color: t.color.text }}>
                  {item.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: t.color.textMuted }}>{item.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
