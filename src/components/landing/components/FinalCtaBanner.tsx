/**
 * CTA final — direciona ao fluxo de cadastro/planos existente.
 */

'use client';

import Link from 'next/link';
import { landingTheme as t } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
.nx-final-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease; }
@media (hover: hover) { .nx-final-cta:hover { box-shadow: 0 16px 44px -10px rgba(255, 255, 255, 0.35); transform: translateY(-1px); } }
`;

export function FinalCtaBanner() {
  return (
    <section id="comecar" style={{ padding: '48px 0 96px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        <Reveal>
          <div
            style={{
              padding: 1.5,
              borderRadius: t.radius.xl,
              background: `linear-gradient(135deg, ${t.color.secondary} 0%, ${t.color.accent} 100%)`,
              boxShadow: '0 24px 80px -24px rgba(37, 99, 235, 0.45)',
            }}
          >
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
                Pronto para organizar vendas, estoque e clientes em um só lugar?
              </h2>

              <p style={{ margin: '0 auto 32px', maxWidth: 480, fontSize: 16, lineHeight: 1.6, color: t.color.textBody }}>
                Escolha um plano, crie sua conta e comece a operar com o PDV do Nex Gestão Vendas.
              </p>

              <Link
                href="/planos"
                className="nx-final-cta"
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
                }}
              >
                Criar Conta Gratuita
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
