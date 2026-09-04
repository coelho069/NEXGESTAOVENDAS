# Content-Security-Policy (Bloqueador 10)

Policy is emitted by `next.config.mjs` for every route.

## Final directives (production)

- `default-src 'self'`
- `base-uri 'self'`
- `object-src 'none'`
- `frame-ancestors 'none'`
- `form-action 'self'`
- `img-src 'self' data: blob: https://estaovendas.com.br https://nexgestaovendas.com.br`
- `font-src 'self' data:`
- `connect-src 'self' <NEXT_PUBLIC_SUPABASE_URL origin> https://*.supabase.co wss://*.supabase.co`
- `script-src 'self' 'unsafe-inline'`
- `style-src 'self' 'unsafe-inline'`
- `upgrade-insecure-requests`

## Documented exceptions

| Directive | Exception | Why | Risk | Future |
|-----------|-----------|-----|------|--------|
| `script-src` | `'unsafe-inline'` | Next.js App Router / hydration inline bootstrapping still requires it without a nonce pipeline | Inline XSS if an injection sink exists | Move to nonce/`strict-dynamic` when the Next deployment pipeline injects per-request nonces |
| `style-src` | `'unsafe-inline'` | Tailwind/runtime style attributes and component libraries | CSS injection / UI redress | Prefer hashed styles when the build emits stable hashes |
| `connect-src` | `https://*.supabase.co` / `wss://*.supabase.co` | Project URL may differ across environments; wildcard limited to Supabase host suffix | Broader than a single project origin | Prefer pinning to `NEXT_PUBLIC_SUPABASE_URL` origin only when every environment shares that pattern |
| `img-src` | product CDN hosts | Product imagery | Host allowlist growth | Keep explicit hosts only |

Development additionally allows `'unsafe-eval'` and `ws://localhost:3000` for Next/Turbopack HMR.
