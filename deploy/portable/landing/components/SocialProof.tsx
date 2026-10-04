/**
 * SocialProof — eliminação de risco e validação por pares (spec: cases).
 * -----------------------------------------------------------------------------
 * - MetricsBar com os números da spec (+34% conversão, 3.2x velocidade,
 *   R$ 42M transacionados) em destaque tabular.
 * - TestimonialCards com avatar de iniciais (sem depender de imagem externa),
 *   cargo, logotipo corporativo e citação — sombra difusa da spec.
 * - SecurityBadges em cinza monocromático que ganham cor sob hover (spec).
 */

'use client';

import type { CSSProperties } from 'react';
import { landingTheme as t, tabularNums } from '../theme/landing-theme';

const CSS = `
.nx-proof-card { transition: transform ${t.motion.base} ease, box-shadow ${t.motion.base} ease; }
@media (hover: hover) { .nx-proof-card:hover { transform: translateY(-3px); box-shadow: 0 26px 52px -18px rgba(0, 0, 0, 0.65); } }
.nx-sec-badge { filter: grayscale(1); opacity: 0.62; transition: filter ${t.motion.base} ease, opacity ${t.motion.base} ease, border-color ${t.motion.base} ease; }
.nx-sec-badge:hover { filter: grayscale(0); opacity: 1; border-color: rgba(16, 185, 129, 0.35); }
@media (max-width: 900px) { .nx-proof-grid { grid-template-columns: 1fr !important; } }
@media (max-width: 720px) { .nx-proof-metrics { flex-direction: column; gap: 24px !important; } .nx-proof-metrics > div { border-right: none !important; padding: 0 !important; } }
`;

const METRICAS = [
  { valor: '+34%', rotulo: 'em taxa de conversão' },
  { valor: '3.2x', rotulo: 'velocidade de primeiro contato' },
  { valor: 'R$ 42M', rotulo: 'transacionados na plataforma' },
];

const DEPOIMENTOS = [
  {
    nome: 'Marina Duarte',
    cargo: 'Head de Vendas',
    empresa: 'Vertex Log',
    iniciais: 'MD',
    cor: t.color.secondary,
    citacao:
      'Reduzimos o ciclo de venda de 38 para 21 dias. O follow-up automático trouxe de volta leads que estavam esquecidos no funil — sem contratar ninguém a mais.',
  },
  {
    nome: 'Rafael Nogueira',
    cargo: 'Diretor Comercial',
    empresa: 'Aurum Seguros',
    iniciais: 'RN',
    cor: t.color.accent,
    citacao:
      'Em 90 dias a conversão subiu 34% e finalmente temos previsibilidade de pipeline. O DRE comercial fechou a conta do ROI no primeiro mês.',
  },
  {
    nome: 'Camila Reis',
    cargo: 'CEO',
    empresa: 'Prisma Tecnologia',
    iniciais: 'CR',
    cor: '#8B5CF6',
    citacao:
      'Onboarding em uma manhã. Em duas semanas a equipe inteira rodava cadências no WhatsApp sem pedir nada para o time de TI.',
  },
];

const SELOS = [
  { titulo: 'Conforme LGPD', sub: 'Dados tratados com base legal e trilha de auditoria', cor: t.color.accent },
  { titulo: 'Criptografia Ponta a Ponta', sub: 'TLS 1.3 em trânsito e AES-256 em repouso', cor: t.color.secondary },
  { titulo: 'Backups Diários', sub: 'Restauração testada com RPO de 24h', cor: '#8B5CF6' },
];

const card: CSSProperties = {
  borderRadius: t.radius.lg,
  border: `1px solid ${t.color.border}`,
  background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.55) 0%, rgba(15, 23, 42, 0.75) 100%)',
  boxShadow: t.shadow.card,
  padding: 28,
  textAlign: 'left',
};

export function SocialProof() {
  return (
    <section id="cases" style={{ padding: '48px 0 96px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        {/* MetricsBar */}
        <div
          className="nx-proof-metrics"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            borderRadius: t.radius.lg,
            border: `1px solid ${t.color.border}`,
            background: 'rgba(15, 23, 42, 0.55)',
            padding: '28px 8px',
            marginBottom: 56,
          }}
        >
          {METRICAS.map((m, i) => (
            <div
              key={m.rotulo}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '0 24px',
                borderRight: i < METRICAS.length - 1 ? `1px solid ${t.color.border}` : 'none',
              }}
            >
              <div style={{ fontFamily: t.font.heading, fontSize: 'clamp(28px, 3.6vw, 40px)', fontWeight: 800, color: t.color.text, lineHeight: 1, ...tabularNums }}>
                {m.valor}
              </div>
              <div style={{ marginTop: 8, fontSize: 13.5, color: t.color.textMuted }}>{m.rotulo}</div>
            </div>
          ))}
        </div>

        {/* TestimonialCards */}
        <div className="nx-proof-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {DEPOIMENTOS.map((d) => (
            <figure key={d.nome} className="nx-proof-card" style={{ ...card, margin: 0, display: 'flex', flexDirection: 'column' }}>
              <div aria-hidden="true" style={{ fontFamily: t.font.heading, fontSize: 34, lineHeight: 1, color: d.cor, opacity: 0.7 }}>
                &ldquo;
              </div>
              <blockquote style={{ margin: '10px 0 22px', flex: 1, fontSize: 14.5, lineHeight: 1.65, color: t.color.textBody }}>
                {d.citacao}
              </blockquote>
              <figcaption style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: `1px solid ${t.color.border}`, paddingTop: 18 }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 44,
                    height: 44,
                    borderRadius: t.radius.full,
                    background: `linear-gradient(135deg, ${d.cor} 0%, rgba(15, 23, 42, 0.9) 140%)`,
                    color: '#FFFFFF',
                    fontFamily: t.font.heading,
                    fontSize: 14,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {d.iniciais}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.color.text }}>{d.nome}</div>
                  <div style={{ fontSize: 12.5, color: t.color.textMuted }}>
                    {d.cargo} · {d.empresa}
                  </div>
                </div>
                {/* logotipo corporativo (monograma vetorial) */}
                <span
                  aria-hidden="true"
                  style={{
                    marginLeft: 'auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    border: `1px solid ${t.color.border}`,
                    background: 'rgba(255,255,255,0.04)',
                    color: t.color.textMuted,
                    fontFamily: t.font.heading,
                    fontSize: 13,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {d.empresa.charAt(0)}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>

        {/* SecurityBadges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 40 }}>
          {SELOS.map((s) => (
            <div
              key={s.titulo}
              className="nx-sec-badge"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 18px',
                borderRadius: t.radius.md,
                border: `1px solid ${t.color.border}`,
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: `${s.cor}22`,
                  color: s.cor,
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.color.text }}>{s.titulo}</div>
                <div style={{ fontSize: 11.5, color: t.color.textMuted }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
