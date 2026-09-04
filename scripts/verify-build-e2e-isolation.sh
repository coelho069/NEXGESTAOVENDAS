#!/usr/bin/env bash
# Proves that `pnpm build` and Playwright E2E can run at the same time without
# sharing/corrupting Next output dirs. Failures must surface (no retries, no sleep).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-2}"
BUILD_LOG="$(mktemp)"
E2E_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG" "$E2E_LOG"' EXIT

for ((round = 1; round <= ROUNDS; round++)); do
  echo "==> isolation round ${round}/${ROUNDS}: cleaning dist dirs"
  rm -rf .next .next-e2e

  echo "==> isolation round ${round}: starting build + e2e concurrently"
  # CI=1 forces Playwright to start its own webServer (no reuse) with
  # NEX_NEXT_DIST_DIR=.next-e2e from playwright.config.ts — no retries relied upon
  # for the race itself (retries only affect individual test flakes under CI).
  pnpm build >"$BUILD_LOG" 2>&1 &
  BUILD_PID=$!
  CI=1 pnpm exec playwright test tests/e2e/smoke.spec.ts --retries=0 >"$E2E_LOG" 2>&1 &
  E2E_PID=$!

  BUILD_EXIT=0
  E2E_EXIT=0
  wait "$BUILD_PID" || BUILD_EXIT=$?
  wait "$E2E_PID" || E2E_EXIT=$?

  if [[ "$BUILD_EXIT" -ne 0 ]]; then
    echo "BUILD FAILED (exit ${BUILD_EXIT}) during concurrent isolation round ${round}"
    tail -80 "$BUILD_LOG"
    exit "$BUILD_EXIT"
  fi
  if [[ "$E2E_EXIT" -ne 0 ]]; then
    echo "E2E FAILED (exit ${E2E_EXIT}) during concurrent isolation round ${round}"
    tail -80 "$E2E_LOG"
    exit "$E2E_EXIT"
  fi

  if [[ ! -d .next ]]; then
    echo "expected .next after concurrent build"
    exit 1
  fi
  if [[ ! -d .next-e2e ]]; then
    echo "expected .next-e2e after concurrent Playwright webServer"
    exit 1
  fi

  echo "==> isolation round ${round}: PASS (build=.next e2e=.next-e2e)"
done

echo "==> build/e2e isolation OK (${ROUNDS} rounds)"
