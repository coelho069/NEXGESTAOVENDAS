'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

type RevealProps = {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
  className?: string;
};

/**
 * Animação de entrada ao rolar — respeita prefers-reduced-motion.
 * Conteúdo permanece visível mesmo sem animação (opacity inicial 1 quando reduced).
 */
export function Reveal({ children, delay = 0, style, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  const motionStyle: CSSProperties = reduced
    ? {}
    : {
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(16px)',
        transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
      };

  return (
    <div ref={ref} className={className} style={{ ...motionStyle, ...style }}>
      {children}
    </div>
  );
}
