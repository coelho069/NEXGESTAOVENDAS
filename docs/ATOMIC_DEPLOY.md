# Atomic deploy checklist (Next.js standalone)

Permanent fail-closed gates. **Do not announce deploy green** unless every
step below succeeds. Incomplete static (the **#5/#8 pattern**: `server.js`
present, `.next/standalone/.next/static` empty or missing chunks) is a failed
deploy even if the process starts.

## Checklist (in order)

1. **Stop** the running Node process (drain / SIGTERM). Do not overwrite a live tree.
2. **Build** (`pnpm build`) so `.next/standalone` and `.next/static` exist.
3. **Copy static into standalone** (Next does not do this for `output: "standalone"`):

   ```bash
   mkdir -p .next/standalone/.next
   rm -rf .next/standalone/.next/static
   cp -a .next/static .next/standalone/.next/static
   ```

   Docker already copies this (`COPY .next/static ./.next/static` in `Dockerfile`).
   Bare-metal / systemd / rsync deploys must copy it explicitly.
4. **Check script** (artifacts only — run **before** start):

   ```bash
   bash scripts/nex-atomic-deploy-check.sh
   ```

   Exit non-zero ⇒ **not green**. The script requires:
   - `.next/standalone/server.js`
   - `.next/standalone/.next/static` with file count **> 0**
   - files referenced by built HTML/RSC **or** `*.css` + `*main-app*` chunk patterns
     (refs are trimmed; a trailing `\` from escaped RSC/JSON quotes is stripped)
5. **Start** the standalone server (`node .next/standalone/server.js`, `PORT` as deployed).
6. **Readiness + sample chunk 200** (after start), default host port **3211**:

   ```bash
   bash scripts/nex-atomic-deploy-check.sh \
     --readiness http://127.0.0.1:3211/health/readiness
   ```

   Optional explicit chunk:

   ```bash
   bash scripts/nex-atomic-deploy-check.sh \
     --readiness \
     --sample-chunk "http://127.0.0.1:3211/_next/static/chunks/<main-app>.js"
   ```

`--readiness` also curls a derived `/_next/static/` file from the standalone
tree. Any non-200 ⇒ **not green**.

## Optional nginx hardening

If production nginx already serves `/_next/static/` from disk (`alias` / `root`),
**keep that**. It is optional hardening so hashed CSS/JS can be served even when
Node is up but a copy was missed. Do not remove an existing alias.

See the commented `location /_next/static/` block in `deploy/nginx.conf.example`.
The Node standalone tree must still contain static; nginx alias is defense in
depth, not a substitute for step 3 + the check script.

## What this is not

- Not a payment, PIX, Stripe, landing, or SaaS change.
- `pnpm start` (non-standalone) is a different layout; this checklist is for
  standalone / Docker / systemd `node server.js`.
