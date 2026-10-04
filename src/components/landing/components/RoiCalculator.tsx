/**
 * RoiCalculator — valor financeiro tangível antes da tabela de planos (spec).
 * -----------------------------------------------------------------------------
 * - Painel em rgba(30,41,59,0.6) com backdrop blur de 20px (spec).
 * - Dois sliders (vendedores, ticket médio) com trilha em gradiente de acento
 *   (#10B981 preenchendo até o valor, resto em branco 12%).
 * - Resultados em tipografia tabular: nada "pula" enquanto o slider corre.
 * - Premissas explícitas e conservadoras (mostradas abaixo do card) — sem
 *   número mágico escondido: 10 negócios/vendedor/mês, conversão base 12%,
 *   +34% de conversão (métrica real dos cases) e 12h/mês economizadas por
 *   vendedor em tarefas manuais.
 */

'use client';

import { useState, type CSSProperties } from 'react';
import { landingTheme as t, tabularNums, brl } from '../theme/landing-theme';

/* ------------------------------- premissas -------------------------------- */

const NEGOCIOS_POR_VENDEDOR_MES = 10;
const CONVERSAO_BASE = 0.12;
const LIFT_CONVERSAO = 0.34;
const HORAS_MANUAIS_POR_VENDEDOR_MES = 12;

const CSS = `
.nx-roi-range { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; border-radius: 9999px; outline: none; cursor: pointer; }
.nx-roi-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #FFFFFF; border: 3px solid ${t.color.accent}; box-shadow: 0 4px 14px rgba(16,185,129,0.5); cursor: grab; }
.nx-roi-range::-webkit-slider-thumb:active { cursor: grabbing; }
.nx-roi-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #FFFFFF; border: 3px solid ${t.color.accent}; box-shadow: 0 4px 14px rgba(16,185,129,0.5); cursor: grab; }
.nx-roi-range::-moz-range-track { height: 8px; border-radius: 9999px; background: transparent; }
.nx-roi-range:focus-visible { outline: 2px solid ${t.color.accent}; outline-offset: 6px; }
.nx-roi-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease; }
@media (hover: hover) { .nx-roi-cta:hover { box-shadow: ${t.shadow.ctaAccentGlow}; transform: translateY(-1px); filter: brightness(1.05); } }
@media (max-width: 720px) { .nx-roi-result { grid-template-columns: 1fr !important; } }
`;

const trilha = (valor: number, min: number, max: number): CSSProperties => {
  const pct = ((valor - min) / (max - min)) * 100;
  return {
    background: `linear-gradient(90deg, ${t.color.accent} 0%, ${t.color.accent} ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`,
  };
};

export function RoiCalculator() {
  const [vendedores, setVendedores] = useState(8);
  const [ticket, setTicket] = useState(2500);

  // +34% sobre a conversão base → vendas adicionais por vendedor/mês.
  const vendasAdicionais =
    vendedores * NEGOCIOS_POR_VENDEDOR_MES * CONVERSAO_BASE * LIFT_CONVERSAO;
  const receitaAdicional = vendasAdicionais * ticket;
  const horasEconomizadas = vendedores * HORAS_MANUAIS_POR_VENDEDOR_MES;

  const resultados = [
    { valor: vendasAdicionais.toLocaleString('pt-BR', { maximumFractionDigits: 1 }), rotulo: 'vendas adicionais por mês', cor: t.color.accent },
    { valor: brl(receitaAdicional), rotulo: 'em receita adicional estimada / mês', cor: t.color.accent },
    { valor: `${horasEconomizadas} h`, rotulo: 'de trabalho manual economizadas / mês', cor: '#93C5FD' },
  ];

  return (
    <section id="roi" style={{ padding: '48px 0 96px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 24px' }}>
        <h2
          style={{
            margin: '0 0 12px',
            textAlign: 'center',
            fontFamily: t.font.heading,
            fontSize: 'clamp(26px, 3.4vw, 38px)',
            fontWeight: 800,
            letterSpacing: '-0.01em',
            color: t.color.text,
          }}
        >
          Calcule quanto tempo e receita sua equipe recupera por mês
        </h2>
        <p style={{ margin: '0 auto 40px', maxWidth: 520, textAlign: 'center', fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
          Dois números. Uma estimativa honesta — e o ROI aparece antes de qualquer proposta.
        </p>

        <div
          style={{
            borderRadius: t.radius.xl,
            border: `1px solid ${t.color.glassBorder}`,
            background: t.color.roiPanelBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: 'clamp(24px, 4vw, 40px)',
            boxShadow: '0 24px 60px -24px rgba(0, 0, 0, 0.6)',
          }}
        >
          {/* Slider 1 — vendedores */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12 }}>
              <label htmlFor="nx-roi-vendedores" style={{ fontSize: 14.5, fontWeight: 600, color: t.color.textBody }}>
                Número de vendedores na equipe
              </label>
              <span style={{ fontFamily: t.font.heading, fontSize: 20, fontWeight: 800, color: t.color.text, ...tabularNums }}>
                {vendedores}
              </span>
            </div>
            <input
              id="nx-roi-vendedores"
              className="nx-roi-range"
              type="range"
              min={1}
              max={50}
              step={1}
              value={vendedores}
              onChange={(e) => setVendedores(Number(e.target.value))}
              style={trilha(vendedores, 1, 50)}
              aria-valuetext={`${vendedores} vendedores`}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5, color: t.color.textMuted, ...tabularNums }}>
              <span>1</span>
              <span>50</span>
            </div>
          </div>

          {/* Slider 2 — ticket médio */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12 }}>
              <label htmlFor="nx-roi-ticket" style={{ fontSize: 14.5, fontWeight: 600, color: t.color.textBody }}>
                Ticket médio das operações
              </label>
              <span style={{ fontFamily: t.font.heading, fontSize: 20, fontWeight: 800, color: t.color.text, ...tabularNums }}>
                {brl(ticket)}
              </span>
            </div>
            <input
              id="nx-roi-ticket"
              className="nx-roi-range"
              type="range"
              min={200}
              max={20000}
              step={100}
              value={ticket}
              onChange={(e) => setTicket(Number(e.target.value))}
              style={trilha(ticket, 200, 20000)}
              aria-valuetext={brl(ticket)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5, color: t.color.textMuted, ...tabularNums }}>
              <span>{brl(200)}</span>
              <span>{brl(20000)}</span>
            </div>
          </div>

          {/* ResultCardHighlight */}
          <div
            aria-live="polite"
            style={{
              borderRadius: t.radius.lg,
              border: '1px solid rgba(16, 185, 129, 0.28)',
              background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)',
              padding: 'clamp(20px, 3vw, 28px)',
            }}
          >
            <div className="nx-roi-result" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
              {resultados.map((r) => (
                <div key={r.rotulo}>
                  <div style={{ fontFamily: t.font.heading, fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 800, color: r.cor, lineHeight: 1.1, ...tabularNums }}>
                    {r.valor}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: t.color.textMuted }}>{r.rotulo}</div>
                </div>
              ))}
            </div>
            <p style={{ margin: '20px 0 0', fontSize: 11.5, lineHeight: 1.6, color: t.color.textMuted }}>
              Estimativa com base na média de clientes: +34% de conversão e 3,2x mais velocidade no primeiro contato,
              considerando 10 negócios por vendedor/mês e conversão base de 12%.
            </p>
          </div>

          {/* CTAInline */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
            <a
              className="nx-roi-cta"
              href="/planos"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 52,
                padding: '0 28px',
                borderRadius: t.radius.md,
                background: `linear-gradient(135deg, ${t.color.accent} 0%, #0EA371 100%)`,
                color: t.color.accentText,
                fontSize: 15,
                fontWeight: 800,
                textDecoration: 'none',
                fontFamily: t.font.heading,
              }}
            >
              Destravar essa eficiência agora →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
