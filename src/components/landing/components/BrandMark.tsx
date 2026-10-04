import { landingTheme as t } from '../theme/landing-theme';

type BrandMarkProps = {
  size?: number;
  gradientId?: string;
};

/** Logotipo vetorial NexGestão (gradiente esmeralda → azul). */
export function BrandMark({ size = 28, gradientId = 'nx-brand-grad' }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="28" x2="28" y2="4">
          <stop offset="0%" stopColor={t.color.accent} />
          <stop offset="100%" stopColor={t.color.secondary} />
        </linearGradient>
      </defs>
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8.5"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.5"
        opacity="0.55"
      />
      <path
        d="M9.5 23V9.5l13 13V9"
        stroke={`url(#${gradientId})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
