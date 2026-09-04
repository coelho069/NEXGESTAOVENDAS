# BLOQUEADOR 13 — Correção de race condition (build × E2E)

## Causa raiz

`pnpm build` (`next build` → `.next`) e o `webServer` do Playwright (`pnpm dev` → mesmo `.next`) compartilhavam o diretório de saída/cache. Em execução concorrente:

- Build falhava com `PageNotFoundError: Cannot find module for page: /_document` (exit 1)
- E2E degradava (timeouts / páginas inconsistentes)

Reprodução (pré-fix): `BUILD_EXIT=1`, `E2E_EXIT=1` ao lançar ambos em paralelo no mesmo workspace.

## Correção aplicada

| Camada | Solução | Arquivos |
|--------|---------|----------|
| **B — Isolamento** | `distDir` via `NEX_NEXT_DIST_DIR`; E2E usa `.next-e2e` | `next.config.mjs`, `playwright.config.ts`, `src/lib/production/next-dist-dir.ts` |
| **A — Serialização** | Pipeline `typecheck → lint → test → build → test:e2e` | `scripts/verify-pipeline.sh`, `package.json` `verify:pipeline` |
| Prova concorrente | Build + smoke E2E em paralelo, 2 rounds, sem retries da race | `scripts/verify-build-e2e-isolation.sh` |
| Gitignore / lint | Ignorar `.next-e2e` | `.gitignore`, `.eslintrc.json` |

Sem `sleep`, sem retries para mascarar a race, sem alteração de migrations.
