/**
 * HeroSection — captura imediata de valor (spec: hero_conversion).
 * -----------------------------------------------------------------------------
 * - Fundo com gradiente radial #2563EB a ~12% no topo, esvaindo em #0B0F19.
 * - Dual CTA: e-mail + "Iniciar Demonstração Guiada" (validação inline,
 *   mensagem acessível via aria-live — sem depender de backend aqui).
 * - Mockup do dashboard em perspectiva isométrica (CSS transform apenas —
 *   sem imagens externas), com borda luminosa (0 0 50px -10px rgba(37,99,235,.35))
 *   e reflexo linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 100%).
 */

'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { landingTheme as t, tabularNums } from '../theme/landing-theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const CSS = `
.nx-hero-input:focus { border-color: rgba(37,99,235,0.6) !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.25); outline: none; }
.nx-hero-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease; }
@media (hover: hover) { .nx-hero-cta:hover { box-shadow: ${t.shadow.ctaGlow}; transform: translateY(-1px); filter: brightness(1.06); } }
@keyframes nx-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.nx-hero-chip { animation: nx-float 6s ease-in-out infinite; }
.nx-hero-chip-slow { animation: nx-float 7.5s ease-in-out infinite; }
@keyframes nx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.nx-pulse { animation: nx-pulse 2.2s ease-in-out infinite; }
@media (max-width: 760px) { .nx-hero-mock { transform: none !important; } }
`;

/* ------------------------------- mockup data ------------------------------ */

const FUNIL = [
  {
    nome: 'Novo lead',
    cor: '#94A3B8',
    cartoes: [
      { titulo: 'MetalParts Indústria', valor: 'R$ 12.400', tag: 'Score 91', tagCor: t.color.accent },
      { titulo: 'Clínica Vitalis', valor: 'R$ 8.900', tag: 'Score 76', tagCor: '#94A3B8' },
    ],
  },
  {
    nome: 'Proposta enviada',
    cor: t.color.secondary,
    cartoes: [{ titulo: 'Aurum Seguros', valor: 'R$ 24.000', tag: 'Follow-up ✓', tagCor: t.color.secondary }],
  },
  {
    nome: 'Fechamento',
    cor: t.color.accent,
    cartoes: [{ titulo: 'Vertex Log', valor: 'R$ 31.500', tag: 'Ganho ✓', tagCor: t.color.accent }],
  },
];

const BARRAS = [34, 52, 41, 66, 58, 74, 92];

/* --------------------------------- estilos -------------------------------- */

const sectionStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  paddingTop: 'clamp(128px, 18vh, 176px)',
  paddingBottom: 96,
  background:
    'radial-gradient(1100px 540px at 50% -120px, rgba(37, 99, 235, 0.14) 0%, rgba(37, 99, 235, 0.05) 45%, transparent 72%)',
};

const container: CSSProperties = {
  maxWidth: t.layout.max,
  margin: '0 auto',
  padding: '0 24px',
  textAlign: 'center',
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

/* -------------------------------- componente ------------------------------ */

export function HeroSection() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'ok' | 'erro'>('idle');

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setStatus(EMAIL_RE.test(email.trim()) ? 'ok' : 'erro');
  };

  return (
    <section style={sectionStyle}>
      <style>{CSS}</style>
      <div style={container}>
        {/* SocialProofBadge */}
        <div style={badge}>
          <span
            className="nx-pulse"
            style={{ width: 8, height: 8, borderRadius: t.radius.full, background: t.color.accent, display: 'inline-block' }}
            aria-hidden="true"
          />
          +1.200 operações comerciais ativas&nbsp;<span style={{ color: t.color.textMuted }}>|</span>&nbsp;99.8% SLA
        </div>

        {/* HeadlineDisplay */}
        <h1
          style={{
            margin: '28px auto 20px',
            maxWidth: 880,
            fontFamily: t.font.heading,
            fontSize: 'clamp(34px, 5.2vw, 60px)',
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            color: t.color.text,
          }}
        >
          O CRM definitivo para escalar pipelines e{' '}
          <span
            style={{
              background: `linear-gradient(90deg, ${t.color.secondary}, ${t.color.accent})`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            fechar vendas
          </span>{' '}
          no piloto estratégico
        </h1>

        {/* SubheadlineParagraph */}
        <p
          style={{
            margin: '0 auto 36px',
            maxWidth: 640,
            fontSize: 18,
            lineHeight: 1.6,
            color: t.color.textMuted,
          }}
        >
          Centralize leads, automatize follow-ups via WhatsApp e visualize métricas de conversão em tempo real sem
          complexidade técnica.
        </p>

        {/* DualCTAContainer */}
        <form
          onSubmit={enviar}
          noValidate
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 12,
            maxWidth: 560,
            margin: '0 auto',
          }}
        >
          <label htmlFor="nx-hero-email" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Seu e-mail de trabalho
          </label>
          <input
            id="nx-hero-email"
            className="nx-hero-input"
            type="email"
            placeholder="Seu e-mail de trabalho"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setStatus('idle');
            }}
            style={{
              flex: '1 1 280px',
              height: 52,
              padding: '0 18px',
              borderRadius: t.radius.md,
              border: `1px solid ${t.color.borderStrong}`,
              background: 'rgba(30, 41, 59, 0.6)',
              color: t.color.text,
              fontSize: 15,
              fontFamily: t.font.body,
            }}
          />
          <button
            className="nx-hero-cta"
            type="submit"
            style={{
              height: 52,
              padding: '0 24px',
              borderRadius: t.radius.md,
              border: 'none',
              background: `linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 100%)`,
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: t.font.body,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Iniciar Demonstração Guiada
          </button>
        </form>

        <p
          aria-live="polite"
          style={{
            minHeight: 22,
            margin: '14px 0 0',
            fontSize: 13.5,
            fontWeight: 500,
            color: status === 'ok' ? t.color.accent : status === 'erro' ? '#F87171' : 'transparent',
          }}
        >
          {status === 'ok'
            ? `✓ Perfeito! Sua demonstração guiada será enviada para ${email.trim()}.`
            : status === 'erro'
              ? 'Verifique o e-mail informado e tente novamente.'
              : '.'}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: t.color.textMuted }}>
          14 dias grátis · Sem cartão de crédito · Setup em 10 minutos
        </p>

        {/* InteractiveDashboardMockup — perspectiva isométrica em CSS puro */}
        <div style={{ position: 'relative', maxWidth: 960, margin: '72px auto 0' }}>
          <div
            className="nx-hero-mock"
            style={{
              position: 'relative',
              borderRadius: t.radius.lg,
              border: '1px solid rgba(255, 255, 255, 0.10)',
              boxShadow: t.shadow.heroGlow,
              background: '#0D1322',
              transform: 'perspective(1600px) rotateX(12deg) rotateY(-6deg)',
              transformStyle: 'preserve-3d',
              overflow: 'hidden',
              textAlign: 'left',
            }}
          >
            {/* reflexo da spec */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.1) 0%, transparent 100%)',
                pointerEvents: 'none',
                zIndex: 3,
              }}
            />
            {/* barra da janela */}
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
              <span style={{ marginLeft: 8, fontSize: 12.5, color: t.color.textMuted, ...tabularNums }}>
                Pipeline · Outubro
              </span>
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
                  ...tabularNums,
                }}
              >
                SLA 99.8%
              </span>
            </div>

            {/* corpo: funil + analítico */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {FUNIL.map((col) => (
                  <div key={col.nome} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: t.color.textBody }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: col.cor }} aria-hidden="true" />
                      {col.nome}
                    </div>
                    {col.cartoes.map((c) => (
                      <div key={c.titulo} style={mockCard}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.color.text }}>{c.titulo}</div>
                        <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: t.color.text, ...tabularNums }}>
                          {c.valor}
                        </div>
                        <div
                          style={{
                            marginTop: 8,
                            display: 'inline-block',
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: c.tagCor,
                            background: `${c.tagCor}1F`,
                            borderRadius: t.radius.full,
                            padding: '2px 8px',
                            ...tabularNums,
                          }}
                        >
                          {c.tag}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* painel analítico */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={mockCard}>
                  <div style={{ fontSize: 11, color: t.color.textMuted }}>Receita do mês</div>
                  <div style={{ marginTop: 4, fontFamily: t.font.heading, fontSize: 20, fontWeight: 800, color: t.color.text, ...tabularNums }}>
                    R$ 184.400
                  </div>
                </div>
                <div style={{ ...mockCard, flex: 1 }}>
                  <div style={{ fontSize: 11, color: t.color.textMuted, marginBottom: 10 }}>Conversão semanal</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 84 }}>
                    {BARRAS.map((h, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: `${h}%`,
                          borderRadius: 4,
                          background: i === BARRAS.length - 1 ? t.color.accent : 'rgba(37, 99, 235, 0.55)',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* chips flutuantes de profundidade */}
          <div
            className="nx-hero-chip"
            style={{
              position: 'absolute',
              top: -18,
              right: 28,
              zIndex: 4,
              padding: '10px 16px',
              borderRadius: t.radius.md,
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              boxShadow: t.shadow.ctaAccentGlow,
              fontSize: 13,
              fontWeight: 700,
              color: t.color.accent,
              ...tabularNums,
            }}
          >
            +34% conversão ↑
          </div>
          <div
            className="nx-hero-chip-slow"
            style={{
              position: 'absolute',
              bottom: -16,
              left: 32,
              zIndex: 4,
              padding: '10px 16px',
              borderRadius: t.radius.md,
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(37, 99, 235, 0.35)',
              boxShadow: t.shadow.ctaGlow,
              fontSize: 13,
              fontWeight: 700,
              color: '#93C5FD',
            }}
          >
            ⚡ Follow-up automático enviado
          </div>
        </div>
      </div>
    </section>
  );
}
