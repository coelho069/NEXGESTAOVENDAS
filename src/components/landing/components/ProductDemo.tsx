/**
 * Demonstração visual do sistema — composição CSS, sem screenshots fictícios.
 */

'use client';

import { landingTheme as t, tabularNums } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
@media (max-width: 800px) { .nx-demo-grid { grid-template-columns: 1fr !important; } }
`;

const PANELS = [
  { label: 'PDV', sub: 'Caixa offline-first', accent: t.color.accent },
  { label: 'Estoque', sub: 'Movimentações auditadas', accent: '#93C5FD' },
  { label: 'Clientes', sub: 'Cadastro centralizado', accent: '#A78BFA' },
  { label: 'Dashboard', sub: 'Indicadores da loja', accent: t.color.accent },
];

export function ProductDemo() {
  return (
    <section id="demo" style={{ padding: '48px 0 80px' }}>
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
              Veja como o sistema organiza sua operação
            </h2>
            <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
              Representação ilustrativa da interface — módulos reais do Nex Gestão Vendas.
            </p>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div
            className="nx-demo-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 32,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                borderRadius: t.radius.xl,
                border: `1px solid ${t.color.border}`,
                background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)',
                padding: 24,
                boxShadow: t.shadow.card,
              }}
              aria-hidden="true"
            >
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                {['#F87171', '#FBBF24', '#34D399'].map((c) => (
                  <span key={c} style={{ width: 10, height: 10, borderRadius: t.radius.full, background: c, opacity: 0.75 }} />
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {PANELS.map((p) => (
                  <div
                    key={p.label}
                    style={{
                      borderRadius: t.radius.md,
                      border: `1px solid ${t.color.border}`,
                      background: 'rgba(255,255,255,0.03)',
                      padding: 16,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: p.accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {p.label}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: t.color.text }}>{p.sub}</div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 16,
                  borderRadius: t.radius.md,
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  background: 'rgba(16, 185, 129, 0.08)',
                  padding: '14px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 13, color: t.color.textBody }}>Vendas do dia</span>
                <span style={{ fontFamily: t.font.heading, fontSize: 20, fontWeight: 800, color: t.color.accent, ...tabularNums }}>
                  R$ 4.280
                </span>
              </div>
            </div>

            <div style={{ textAlign: 'left' }}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {[
                  'Venda no caixa atualiza o estoque automaticamente.',
                  'Consulte clientes e histórico sem sair do PDV.',
                  'Acompanhe indicadores no dashboard (plano Enterprise).',
                  'Importe ajustes de estoque via CSV quando necessário.',
                ].map((item) => (
                  <li key={item} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: 22,
                        height: 22,
                        borderRadius: t.radius.full,
                        background: 'rgba(16, 185, 129, 0.15)',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: t.color.accent,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span style={{ fontSize: 15, lineHeight: 1.6, color: t.color.textBody }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
