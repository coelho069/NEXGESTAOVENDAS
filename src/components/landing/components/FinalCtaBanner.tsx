/**
 * FinalCtaBanner — fechamento da jornada sem distrações (spec).
 * -----------------------------------------------------------------------------
 * - Container envelopado em borda com gradiente linear #2563EB → #10B981
 *   (técnica de padding 1.5px + fundo interno — sem pseudo-elementos).
 * - Fundo interno em mesh gradient profundo com iluminação interna
 *   (inset box-shadow) e CTA de altíssimo contraste (branco sobre escuro).
 * - SupportContactLink para WhatsApp: WHATSAPP_URL é PLACEHOLDER — ver
 *   PORTING.md.
 */

'use client';

import { landingTheme as t } from '../theme/landing-theme';

/** PORTING: substitua pelo wa.me real da operação comercial. */
const WHATSAPP_URL = '#';

const CSS = `
.nx-final-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease; }
@media (hover: hover) { .nx-final-cta:hover { box-shadow: 0 16px 44px -10px rgba(255, 255, 255, 0.35); transform: translateY(-1px); } }
.nx-final-wa { color: ${t.color.accent}; text-decoration: none; font-weight: 600; border-bottom: 1px solid rgba(16, 185, 129, 0.4); transition: border-color ${t.motion.fast} ease; }
.nx-final-wa:hover { border-color: ${t.color.accent}; }
`;

export function FinalCtaBanner() {
  return (
    <section id="comecar" style={{ padding: '48px 0 96px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        {/* borda em gradiente (wrapper) */}
        <div
          style={{
            padding: 1.5,
            borderRadius: t.radius.xl,
            background: `linear-gradient(135deg, ${t.color.secondary} 0%, ${t.color.accent} 100%)`,
            boxShadow: '0 24px 80px -24px rgba(37, 99, 235, 0.45)',
          }}
        >
          {/* fundo mesh com iluminação interna */}
          <div
            style={{
              borderRadius: 22.5,
              overflow: 'hidden',
              textAlign: 'center',
              padding: 'clamp(48px, 7vw, 80px) 24px',
              background: [
                'radial-gradient(600px 300px at 18% 0%, rgba(37, 99, 235, 0.28), transparent 62%)',
                'radial-gradient(520px 300px at 82% 100%, rgba(16, 185, 129, 0.22), transparent 62%)',
                '#0F172A',
              ].join(', '),
              boxShadow: 'inset 0 0 90px rgba(37, 99, 235, 0.18), inset 0 0 44px rgba(16, 185, 129, 0.10)',
            }}
          >
            {/* ActionHeadline */}
            <h2
              style={{
                margin: '0 auto 14px',
                maxWidth: 720,
                fontFamily: t.font.heading,
                fontSize: 'clamp(28px, 4vw, 44px)',
                fontWeight: 800,
                lineHeight: 1.14,
                letterSpacing: '-0.015em',
                color: '#FFFFFF',
              }}
            >
              Pronto para transformar sua operação comercial em uma máquina previsível?
            </h2>

            {/* SupportingText */}
            <p style={{ margin: '0 auto 32px', maxWidth: 480, fontSize: 16, lineHeight: 1.6, color: t.color.textBody }}>
              Setup completo em menos de 10 minutos. Sem necessidade de cartão para começar.
            </p>

            {/* CTAButtonPrimaryHighContrast */}
            <a
              className="nx-final-cta"
              href="/planos"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 56,
                padding: '0 36px',
                borderRadius: t.radius.md,
                background: '#FFFFFF',
                color: t.color.primary,
                fontFamily: t.font.heading,
                fontSize: 16,
                fontWeight: 800,
                textDecoration: 'none',
                border: 'none',
              }}
            >
              Criar Conta Gratuita
            </a>

            {/* SupportContactLink */}
            <p style={{ margin: '24px 0 0', fontSize: 14, color: t.color.textMuted }}>
              Prefere falar com um especialista?{' '}
              <a className="nx-final-wa" href={WHATSAPP_URL}>
                Fale via WhatsApp →
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
