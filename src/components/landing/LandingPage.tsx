/**
 * LandingPage — composição da landing de conversão do Nex Gestão Vendas.
 * Conteúdo factual: PDV, estoque, clientes e planos reais do sistema.
 */

'use client';

import { landingTheme as t } from './theme/landing-theme';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { BenefitsSection } from './components/BenefitsSection';
import { BentoFeatures } from './components/BentoFeatures';
import { ProductDemo } from './components/ProductDemo';
import { PlansPreview } from './components/PlansPreview';
import { TrustSection } from './components/TrustSection';
import { FaqSection } from './components/FaqSection';
import { FinalCtaBanner } from './components/FinalCtaBanner';
import { Footer } from './components/Footer';

const CSS = `
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
section[id] { scroll-margin-top: ${t.layout.navClearance}; }
`;

export function LandingPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: t.color.bg,
        color: t.color.text,
        fontFamily: t.font.body,
        WebkitFontSmoothing: 'antialiased',
        overflowX: 'hidden',
      }}
    >
      <style>{CSS}</style>
      <Navbar />
      <main>
        <HeroSection />
        <BenefitsSection />
        <BentoFeatures />
        <ProductDemo />
        <PlansPreview />
        <TrustSection />
        <FaqSection />
        <FinalCtaBanner />
      </main>
      <Footer />
    </div>
  );
}
