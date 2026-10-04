/**
 * BentoFeatures — pilares da plataforma em Bento Grid assimétrico (spec).
 * -----------------------------------------------------------------------------
 * - Grid de 6 colunas com template-areas: 1 card grande (WhatsApp), 2 médios
 *   (Kanban, Integrações) e 2 pequenos (Score, DRE) — assimetria da spec.
 * - Superfícies em Dark Neumorphism sutil (surface → primary), borda fina
 *   rgba(255,255,255,0.06) e hover com scale(1.02) + glow perimetral.
 * - Badge de Score de Leads é DINÂMICO (cicla valores a cada 2,2s) — spec
 *   pede "badge numérico dinâmico".
 */

'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { landingTheme as t, tabularNums } from '../theme/landing-theme';

const CSS = `
@keyframes nx-bento-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.nx-score-badge { animation: nx-bento-in 380ms ease; }
.nx-bento { transition: transform ${t.motion.base} ease, box-shadow ${t.motion.base} ease, border-color ${t.motion.base} ease; }
@media (hover: hover) {
  .nx-bento:hover { transform: scale(1.02); border-color: rgba(37, 99, 235, 0.35) !important; box-shadow: ${t.shadow.bentoHover}; }
}
@media (max-width: 960px) {
  .nx-bento-grid { grid-template-areas: 'a' 'b' 'c' 'd' 'e' !important; grid-template-columns: 1fr !important; }
}
`;

/* --------------------------------- helpers -------------------------------- */

const cardBase: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: t.radius.lg,
  border: `1px solid ${t.color.border}`,
  background: 'linear-gradient(145deg, #1E293B 0%, #101828 55%, #0D1424 100%)',
  padding: 28,
  textAlign: 'left',
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

const Desc = ({ children }: { children: ReactNode }) => (
  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: t.color.textMuted }}>{children}</p>
);

/* ícones vetoriais mínimos */
const IconChat = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.5A8 8 0 1 1 21 12Z" />
    <path d="M9 11h.01M13 11h.01" />
  </svg>
);
const IconKanban = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4" width="5" height="14" rx="1.5" />
    <rect x="10" y="4" width="5" height="9" rx="1.5" />
    <rect x="17" y="4" width="4" height="12" rx="1.5" />
  </svg>
);
const IconTarget = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);
const IconChart = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  </svg>
);
const IconPlug = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8ZM12 17v4" />
  </svg>
);

/* ------------------------- badge de score dinâmico ------------------------ */

const SCORES = [91, 84, 76, 95];

function ScoreBadge() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % SCORES.length), 2200);
    return () => clearInterval(id);
  }, []);
  const score = SCORES[i];
  return (
    <div
      className="nx-score-badge"
      key={score}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        padding: '10px 18px',
        borderRadius: t.radius.md,
        background: 'rgba(16, 185, 129, 0.12)',
        border: '1px solid rgba(16, 185, 129, 0.35)',
        color: t.color.accent,
        ...tabularNums,
      }}
    >
      <span style={{ fontFamily: t.font.heading, fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{score}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: t.color.textMuted }}>/ 100</span>
    </div>
  );
}

/* -------------------------------- componente ------------------------------ */

export function BentoFeatures() {
  return (
    <section id="recursos" style={{ padding: '48px 0 96px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: t.layout.max, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ margin: '0 0 12px', fontFamily: t.font.heading, fontSize: 'clamp(26px, 3.4vw, 38px)', fontWeight: 800, letterSpacing: '-0.01em', color: t.color.text }}>
            Tudo que a esteira comercial precisa, em um só lugar
          </h2>
          <p style={{ margin: '0 auto', maxWidth: 560, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
            Módulos que conversam entre si — sem planilhas paralelas, sem integração frágil.
          </p>
        </div>

        <div
          className="nx-bento-grid"
          style={{
            display: 'grid',
            gap: t.layout.bentoGap,
            gridTemplateColumns: 'repeat(6, 1fr)',
            gridTemplateAreas: `"a a a a b b" "a a a a c c" "d d e e e e"`,
          }}
        >
          {/* A — WhatsApp (grande, com UI de chat) */}
          <div style={{ ...cardBase, gridArea: 'a' }} className="nx-bento">
            <CardTitle icon={IconChat}>Automação de WhatsApp e Disparo Inteligente de Follow-up</CardTitle>
            <Desc>
              Cadências que disparam no momento certo, com contexto do funil. Respostas do lead voltam direto para o
              card do negócio — sem trocar de aba.
            </Desc>
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
              <div style={{ alignSelf: 'flex-start', maxWidth: '85%', padding: '10px 14px', borderRadius: '14px 14px 14px 4px', background: 'rgba(255,255,255,0.06)', border: `1px solid ${t.color.border}`, fontSize: 13.5, lineHeight: 1.5, color: t.color.textBody }}>
                Olá, Marina! Vi que avaliou nosso plano Growth — posso ajudar com alguma dúvida?
              </div>
              <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '10px 14px', borderRadius: '14px 14px 4px 14px', background: 'rgba(37, 99, 235, 0.85)', fontSize: 13.5, lineHeight: 1.5, color: '#FFFFFF' }}>
                Consigo falar com um consultor amanhã de manhã?
              </div>
              <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '10px 14px', borderRadius: '14px 14px 4px 14px', background: 'rgba(16, 185, 129, 0.16)', border: '1px solid rgba(16, 185, 129, 0.4)', fontSize: 13.5, lineHeight: 1.5, color: t.color.textBody }}>
                Agendado ✓ Amanhã, 09h00 — convite no seu e-mail.
                <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: t.color.accent }}>Follow-up automático · sem intervenção</div>
              </div>
            </div>
          </div>

          {/* B — Kanban (médio) */}
          <div style={{ ...cardBase, gridArea: 'b' }} className="nx-bento">
            <CardTitle icon={IconKanban}>Kanban Drag &amp; Drop</CardTitle>
            <Desc>Previsão de fechamento ponderada por IA, recalculada a cada movimento no funil.</Desc>
            <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['#94A3B8', t.color.secondary, t.color.accent].map((cor, i) => (
                <div key={cor} style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${t.color.border}`, padding: 8, minHeight: 64 }}>
                  <span style={{ display: 'block', width: 8, height: 8, borderRadius: 2, background: cor, marginBottom: 6 }} />
                  {i === 1 && (
                    <div style={{ borderRadius: 6, background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(37,99,235,0.5)', boxShadow: '0 8px 20px rgba(0,0,0,0.5)', padding: '6px 8px', fontSize: 10.5, fontWeight: 600, color: t.color.text, ...tabularNums }}>
                      Vertex Log · 31.5k
                      <div style={{ color: t.color.secondary, fontSize: 9.5 }}>IA: 87%</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* C — Score de leads (pequeno, badge dinâmico) */}
          <div style={{ ...cardBase, gridArea: 'c' }} className="nx-bento">
            <CardTitle icon={IconTarget}>Score de Leads preditivo</CardTitle>
            <Desc>Priorize quem vai fechar. O score reavalia comportamento em tempo real.</Desc>
            <div style={{ marginTop: 18 }}>
              <ScoreBadge />
            </div>
          </div>

          {/* D — DRE e comissões (pequeno) */}
          <div style={{ ...cardBase, gridArea: 'd' }} className="nx-bento">
            <CardTitle icon={IconChart}>Relatórios de DRE Comercial e Comissões Automatizadas</CardTitle>
            <Desc>Resultado por vendedor, canal e produto — sem fechar planilha no fim do mês.</Desc>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, ...tabularNums }}>
              {[
                { rotulo: 'Receita comercial', valor: 'R$ 284.100', cor: t.color.text },
                { rotulo: 'Comissões do período', valor: 'R$ 21.307', cor: t.color.text },
                { rotulo: 'Margem contribuição', valor: '12,4%', cor: t.color.accent },
              ].map((l) => (
                <div key={l.rotulo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: `1px solid ${t.color.border}`, paddingBottom: 8 }}>
                  <span style={{ color: t.color.textMuted }}>{l.rotulo}</span>
                  <span style={{ fontWeight: 700, color: l.cor }}>{l.valor}</span>
                </div>
              ))}
            </div>
          </div>

          {/* E — Integrações (médio) */}
          <div style={{ ...cardBase, gridArea: 'e' }} className="nx-bento">
            <CardTitle icon={IconPlug}>Integração nativa com ERPs, Gateways e Webhooks em tempo real</CardTitle>
            <Desc>Estoque, financeiro e pagamento sincronizados. Eventos via webhook em menos de 1 segundo.</Desc>
            <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {[
                { sigla: 'ERP', rotulo: 'SAP · Totvs' },
                { sigla: 'PG', rotulo: 'Gateways' },
                { sigla: 'Pix', rotulo: 'Pagamentos' },
                { sigla: 'WH', rotulo: 'Webhooks' },
                { sigla: '+40', rotulo: 'Apps' },
              ].map((chip) => (
                <div key={chip.sigla} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: `1px solid ${t.color.border}` }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: 'rgba(37, 99, 235, 0.15)',
                      color: '#93C5FD',
                      fontSize: 10.5,
                      fontWeight: 700,
                      ...tabularNums,
                    }}
                  >
                    {chip.sigla}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: t.color.textBody }}>{chip.rotulo}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
