/**
 * LandingPage — composição completa da landing de conversão do NexGestão.
 * -----------------------------------------------------------------------------
 * Ordem das seções = esteira cognitiva da spec: Hero → Bento Grid → ROI →
 * Cases → CTA final → Footer.
 *
 * Self-contained: nenhuma dependência além de React. As fontes do guide
 * (Plus Jakarta Sans + Inter) entram por @import do Google Fonts; o host pode
 * trocar por self-host em produção (ver PORTING.md).
 *
 * PORTING: copie a pasta para `src/components/landing/` e monte em
 * `src/app/page.tsx` com `<LandingPage />`.
 */

'use client';

import { landingTheme as t, FONT_IMPORT } from './theme/landing-theme';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { BentoFeatures } from './components/BentoFeatures';
import { RoiCalculator } from './components/RoiCalculator';
import { SocialProof } from './components/SocialProof';
import { FinalCtaBanner } from './components/FinalCtaBanner';
import { Footer } from './components/Footer';

const CSS = `
@import url('${FONT_IMPORT}');
html { scroll-behavior: smooth; }
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
        <BentoFeatures />
        <RoiCalculator />
        <SocialProof />
        <FinalCtaBanner />
      </main>
      <Footer />
    </div>
  );
}
