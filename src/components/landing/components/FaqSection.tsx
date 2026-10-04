/**
 * FAQ acessível — respostas fiéis ao funcionamento real do sistema.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LANDING_FAQ } from '../data/landing-content';
import { landingTheme as t } from '../theme/landing-theme';
import { Reveal } from './Reveal';

const CSS = `
.nx-faq-btn { transition: background ${t.motion.fast} ease; }
.nx-faq-btn:hover { background: rgba(255,255,255,0.03); }
.nx-faq-chevron { transition: transform ${t.motion.base} ease; }
.nx-faq-chevron.open { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) { .nx-faq-chevron { transition: none; } }
`;

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" style={{ padding: '48px 0 80px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <h2
              style={{
                margin: '0 0 12px',
                fontFamily: t.font.heading,
                fontSize: 'clamp(26px, 3.4vw, 38px)',
                fontWeight: 800,
                color: t.color.text,
              }}
            >
              Perguntas frequentes
            </h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
              Tudo que você precisa saber antes de assinar.
            </p>
          </div>
        </Reveal>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {LANDING_FAQ.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <Reveal key={item.question} delay={index * 40}>
                <div
                  style={{
                    borderRadius: t.radius.lg,
                    border: isOpen ? '1px solid rgba(16, 185, 129, 0.35)' : `1px solid ${t.color.border}`,
                    background: 'rgba(30, 41, 59, 0.4)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    className="nx-faq-btn"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    style={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '16px 20px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: t.font.body,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 600, color: t.color.text }}>{item.question}</span>
                    <svg
                      className={`nx-faq-chevron${isOpen ? ' open' : ''}`}
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={t.color.textMuted}
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 20px 18px' }}>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: t.color.textMuted }}>{item.answer}</p>
                      {item.href && item.linkLabel ? (
                        <p style={{ margin: '12px 0 0' }}>
                          <Link
                            href={item.href}
                            style={{ fontSize: 14, fontWeight: 600, color: t.color.accent, textDecoration: 'none' }}
                          >
                            {item.linkLabel}
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
