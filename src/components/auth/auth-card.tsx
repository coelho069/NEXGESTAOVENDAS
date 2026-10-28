"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/landing/components/BrandMark";
import { Reveal } from "@/components/landing/components/Reveal";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";
import { AUTH_CSS } from "@/components/auth/login-form";

export const AUTH_ERROR_STYLE = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: t.radius.md,
  border: "1px solid rgba(239, 68, 68, 0.35)",
  background: "rgba(239, 68, 68, 0.1)",
  color: "#FCA5A5",
  fontSize: 13.5,
  lineHeight: 1.45,
} as const;

export const AUTH_OK_STYLE = {
  ...AUTH_ERROR_STYLE,
  border: "1px solid rgba(16, 185, 129, 0.35)",
  background: "rgba(16, 185, 129, 0.1)",
  color: "#6EE7B7",
} as const;

export const AUTH_LABEL_STYLE = {
  display: "block",
  marginBottom: 8,
  fontWeight: 600,
  color: t.color.textBody,
} as const;

/** Casca visual igual à do login (fundo, cartão de vidro, cabeçalho). */
export function AuthCard(props: {
  title: string;
  subtitle: string;
  onSubmit: (event: React.FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(20px, 5vw, 40px)",
        background: t.color.bg,
        color: t.color.text,
        fontFamily: t.font.body,
        WebkitFontSmoothing: "antialiased",
        overflowX: "hidden",
      }}
    >
      <style>{AUTH_CSS}</style>
      <div
        aria-hidden="true"
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(900px 480px at 50% -80px, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(16, 185, 129, 0.08) 0%, transparent 65%)",
        }}
      />
      <main style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 440 }}>
        <Reveal>
          <form
            onSubmit={props.onSubmit}
            style={{
              width: "100%",
              padding: "clamp(28px, 5vw, 36px)",
              borderRadius: t.radius.xl,
              border: `1px solid ${t.color.glassBorder}`,
              background: t.color.glassBg,
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: `${t.shadow.card}, 0 0 0 1px rgba(255, 255, 255, 0.03) inset`,
            }}
          >
            <div style={{ marginBottom: 28, textAlign: "center" }}>
              <Link
                href="/"
                aria-label="NexGestão — voltar ao início"
                style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", marginBottom: 20 }}
              >
                <BrandMark size={32} gradientId="nx-auth-brand-grad" />
                <span style={{ color: t.color.text, fontFamily: t.font.heading, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  NexGestão
                </span>
              </Link>
              <h1
                style={{
                  margin: "0 0 8px",
                  fontFamily: t.font.heading,
                  fontSize: "clamp(22px, 4vw, 26px)",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: t.color.text,
                }}
              >
                {props.title}
              </h1>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: t.color.textMuted }}>{props.subtitle}</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>{props.children}</div>
            <div
              style={{
                marginTop: 24,
                paddingTop: 20,
                borderTop: `1px solid ${t.color.border}`,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <Link href="/login" className="nx-login-back">
                Voltar ao login
              </Link>
            </div>
          </form>
        </Reveal>
      </main>
    </div>
  );
}
