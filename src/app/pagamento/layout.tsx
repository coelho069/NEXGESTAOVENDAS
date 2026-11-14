import localFont from "next/font/local";
import { landingTheme } from "@/components/landing/theme/landing-theme";

const inter = localFont({
  src: "../fonts/inter-latin-variable.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-inter",
});

const jakarta = localFont({
  src: "../fonts/plus-jakarta-sans-latin-variable.woff2",
  weight: "600 800",
  display: "swap",
  variable: "--font-jakarta",
});

export default function PagamentoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${inter.variable} ${jakarta.variable}`}
      style={{ minHeight: "100vh", background: landingTheme.color.bg, color: landingTheme.color.text }}
    >
      {children}
    </div>
  );
}
