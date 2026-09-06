/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Isolate Next output/cache between production `pnpm build` (`.next`) and the
 * Playwright webServer (`NEX_NEXT_DIST_DIR=.next-e2e`). Sharing `.next` causes
 * intermittent `PageNotFoundError: /_document` races.
 */
function resolveNextDistDir(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return ".next";
  if (raw.startsWith("/") || raw.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid NEX_NEXT_DIST_DIR: ${raw}`);
  }
  return raw;
}

const distDir = resolveNextDistDir(process.env.NEX_NEXT_DIST_DIR);

const configuredSupabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : null;
  } catch {
    return null;
  }
})();

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://estaovendas.com.br https://nexgestaovendas.com.br",
  "font-src 'self' data:",
  `connect-src 'self' ${configuredSupabaseOrigin ?? ""} https://*.supabase.co wss://*.supabase.co${isDevelopment ? " ws://localhost:3000" : ""}`,
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig = {
  distDir,
  output: "standalone",
  serverExternalPackages: ["stripe"],
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "estaovendas.com.br" },
      { protocol: "https", hostname: "nexgestaovendas.com.br" },
    ],
  },
  async headers() {
    const headers = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];

    if (!isDevelopment) {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      });
    }

    return [{ source: "/(.*)", headers }];
  },
};

export default nextConfig;
