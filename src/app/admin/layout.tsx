import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";
import { getPlatformAdminAccess } from "@/lib/auth/admin";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  variable: "--font-jakarta",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ADM — Nex Gestão Vendas",
  description: "Administração de clientes e assinaturas do Nex Gestão Vendas",
};

/** Mesmo gesto visual do login: cartões de vidro, CTA em gradiente e campos escuros. Escopo: .admin-theme. */
const ADMIN_VISUAL_CSS = `
.admin-theme h1, .admin-theme h2 {
  font-family: ${t.font.heading};
  letter-spacing: -0.02em;
}
.admin-theme .pdv-panel,
.admin-theme .pdv-glass-bar,
.admin-theme .pdv-modal-shell {
  border-radius: ${t.radius.xl};
  border: 1px solid ${t.color.glassBorder};
  background: ${t.color.glassBg};
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: ${t.shadow.card}, 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
}
.admin-theme .pdv-input {
  border-radius: ${t.radius.md};
  border: 1px solid ${t.color.borderStrong};
  background: rgba(15, 23, 42, 0.55);
  color: ${t.color.text};
  transition: border-color ${t.motion.fast} ease, box-shadow ${t.motion.fast} ease, background ${t.motion.fast} ease;
}
.admin-theme .pdv-input::placeholder { color: ${t.color.textMuted}; opacity: 0.85; }
.admin-theme .pdv-input:focus {
  border-color: rgba(37, 99, 235, 0.55);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
  background: rgba(15, 23, 42, 0.72);
}
.admin-theme .pdv-btn-primary {
  border: none;
  border-radius: ${t.radius.md};
  background: linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%);
  color: #FFFFFF;
  box-shadow: ${t.shadow.ctaGlow};
  transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease, opacity ${t.motion.fast} ease;
}
@media (hover: hover) {
  .admin-theme .pdv-btn-primary:not(:disabled):hover {
    box-shadow: ${t.shadow.ctaAccentGlow};
    transform: translateY(-1px);
    filter: brightness(1.05);
  }
}
.admin-theme .pdv-btn-primary:disabled { box-shadow: none; filter: grayscale(0.2); }
.admin-theme .pdv-btn-ghost {
  border-radius: ${t.radius.md};
  border: 1px solid ${t.color.borderStrong};
  background: rgba(15, 23, 42, 0.55);
  transition: border-color ${t.motion.fast} ease, background ${t.motion.fast} ease;
}
.admin-theme .pdv-btn-ghost:hover {
  border-color: rgba(37, 99, 235, 0.55);
  background: rgba(15, 23, 42, 0.72);
}
.admin-theme .pdv-alert-warning,
.admin-theme .pdv-alert-error,
.admin-theme .pdv-alert-info {
  border-radius: ${t.radius.md};
}
@media (prefers-reduced-motion: reduce) {
  .admin-theme .pdv-input, .admin-theme .pdv-btn-primary, .admin-theme .pdv-btn-ghost { transition: none; }
  .admin-theme .pdv-btn-primary:not(:disabled):hover { transform: none; }
}
`;

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const access = await getPlatformAdminAccess();
  if (!access) notFound();

  return (
    <div
      className={`admin-theme ${inter.variable} ${jakarta.variable} relative flex min-h-screen overflow-x-hidden bg-background text-foreground`}
      style={{ background: t.color.bg, color: t.color.text, fontFamily: t.font.body, WebkitFontSmoothing: "antialiased" }}
    >
      <style>{ADMIN_VISUAL_CSS}</style>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 480px at 50% -80px, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(16, 185, 129, 0.08) 0%, transparent 65%)",
        }}
      />
      <div className="relative z-10 flex min-h-screen w-full">
        <AdminSidebar />
        <div className="min-w-0 flex-1">
          <div className="mx-auto min-h-screen max-w-[1600px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
