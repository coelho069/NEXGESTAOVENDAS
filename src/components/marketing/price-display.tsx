import React from "react";

interface PriceDisplayProps {
  /** Formatted price string (e.g., "R$ 99.90 / mensal") */
  price: string;
  /** Optional extra classes merged over the default styling */
  className?: string;
}

/**
 * Safe display of a monetary price as a React element.
 *
 * This component replaces the previous usage of
 * `dangerouslySetInnerHTML` in the PlanCard component,
 * ensuring all content is properly escaped and safe.
 */
const PriceDisplay: React.FC<PriceDisplayProps> = ({ price, className }) => {
  return (
    <span className={className ?? "text-3xl font-bold tabular-nums text-slate-900"}>
      {price}
    </span>
  );
};

export default PriceDisplay;
export { PriceDisplay };