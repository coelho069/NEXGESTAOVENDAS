#!/usr/bin/env bash
# Serialized verification pipeline for Nex Gestão Vendas.
# Order is intentional: unit gates first, then production build, then E2E.
# E2E uses an isolated Next distDir (.next-e2e) via playwright.config.ts so a
# concurrent build elsewhere cannot share/corrupt .next — but this script still
# runs build → E2E sequentially so CI never depends on accidental parallelism.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> typecheck"
pnpm typecheck

echo "==> lint"
pnpm lint

echo "==> backup/recovery readiness (honest; no fake success)"
pnpm check:backup

echo "==> unit tests"
pnpm test

echo "==> production build (.next)"
pnpm build

echo "==> e2e (webServer distDir=.next-e2e)"
pnpm test:e2e

echo "==> pipeline OK"
