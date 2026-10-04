/**
 * Funcionalidades reais do produto em Bento Grid assimétrico.
 */

'use client';

import type { CSSProperties, ReactNode } from 'react';
import { LANDING_FEATURES } from '../data/landing-content';
import { landingTheme as t } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
.nx-bento { transition: transform ${t.motion.base} ease, box-shadow ${t.motion.base} ease, border-color ${t.motion.base} ease; }
@media (hover: hover) {
  .nx-bento:hover { transform: translateY(-2px); border-color: rgba(37, 99, 235, 0.35) !important; box-shadow: ${t.shadow.bentoHover}; }
}
@media (max-width: 960px) {
  .nx-bento-grid { grid-template-areas: 'a' 'b' 'c' 'd' 'e' !important; grid-template-columns: 1fr !important; }
}
`;

const cardBase: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: t.radius.lg,
  border: `1px solid ${t.color.border}`,
  background: 'linear-gradient(145deg, #1E293B 0%, #101828 55%, #0D1424 100%)',
  padding: 28,
  textAlign: 'left',
  height: '100%',
};

const ICONS: Record<string, ReactNode> = {
  pdv: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01" />
    </svg>
  ),
  estoque: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 9l9-5 9 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z" />
      <path d="M9 22V12h6v10" />
    </svg>
  ),
  clientes: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M21 21v-1.5a3 3 0 0 0-2-2.83" />
    </svg>
  ),
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
    </svg>
  ),
  pagamentos: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  ),
};

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          borderRadius: 10,
          background: 'rgba(37, 99, 235, 0.16)',
          border: '1px solid rgba(37, 99, 235, 0.35)',
          color: '#93C5FD',
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <h3 style={{ margin: 0, fontFamily: t.font.heading, fontSize: 17, fontWeight: 700, color: t.color.text, lineHeight: 1.3 }}>
        {children}
      </h3>
    </div>
  );
}

export function BentoFeatures() {
  const renderCard = (feature: typeof LANDING_FEATURES[number], extra?: CSSProperties) => (
    <div key={feature.id} style={{ ...cardBase, gridArea: feature.area, ...extra }} className="nx-bento">
      <CardTitle icon={ICONS[feature.id]}>{feature.title}</CardTitle>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: t.color.textMuted }}>{feature.description}</p>
      {feature.id === 'pdv' && (
        <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['Offline-first', 'Sync automático', 'Scanner HID'].map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: t.radius.full,
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: t.color.accent,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {feature.id === 'pagamentos' && (
        <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {['Dinheiro', 'Cartão', 'Pix', 'Stripe'].map((m) => (
            <span
              key={m}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${t.color.border}`,
                color: t.color.textBody,
              }}
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section id="recursos" style={{ padding: '48px 0 80px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2
              style={{
                margin: '0 0 12px',
                fontFamily: t.font.heading,
                fontSize: 'clamp(26px, 3.4vw, 38px)',
                fontWeight: 800,
                letterSpacing: '-0.01em',
                color: t.color.text,
              }}
            >
              Tudo que sua loja precisa para vender e organizar a operação
            </h2>
            <p style={{ margin: '0 auto', maxWidth: 560, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
              Funcionalidades confirmadas no sistema — sem promessas de módulos inexistentes.
            </p>
          </div>
        </Reveal>

        <div
          className="nx-bento-grid"
          style={{
            display: 'grid',
            gap: t.layout.bentoGap,
            gridTemplateColumns: 'repeat(6, 1fr)',
            gridTemplateAreas: `"a a a a b b" "a a a a c c" "d d e e e e"`,
          }}
        >
          {LANDING_FEATURES.map((f, i) => (
            <Reveal key={f.id} delay={i * 60} style={{ gridArea: f.area }}>
              {renderCard(f)}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
