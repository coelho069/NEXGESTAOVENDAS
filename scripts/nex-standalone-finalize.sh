#!/usr/bin/env bash
# Finalize a Next.js standalone build for the production layout of this repo:
# - copy .next/static into .next/standalone/.next/static (Next.js does NOT do this)
# - ensure BUILD_ID matches between .next and the standalone bundle
# - world-readable static tree (nginx `/_next/static/` alias serves it directly)
# - run scripts/nex-atomic-deploy-check.sh as a fail-closed gate
# Usage: bash scripts/nex-standalone-finalize.sh [--root DIR]
set -euo pipefail

ROOT="$(pwd)"
if [[ "${1:-}" == "--root" && -n "${2:-}" ]]; then
  ROOT="$(cd "$2" && pwd)"
fi

DIST="${NEX_NEXT_DIST_DIR:-$ROOT/.next}"
STANDALONE="$DIST/standalone"
STATIC_SRC="$DIST/static"
STATIC_DST="$STANDALONE/.next/static"

fail() {
  echo "STANDALONE FINALIZE FAILED: $*" >&2
  exit 1
}

[[ -f "$STANDALONE/server.js" ]] || fail "missing $STANDALONE/server.js — run the build first"
[[ -d "$STATIC_SRC" ]] || fail "missing $STATIC_SRC — run the build first"

CHUNK_COUNT="$(find "$STATIC_SRC/chunks" -type f 2>/dev/null | wc -l | tr -d ' ')"
[[ "$CHUNK_COUNT" -gt 0 ]] || fail "$STATIC_SRC/chunks has no files — build output incomplete"

if [[ -f "$DIST/BUILD_ID" && -f "$STANDALONE/.next/BUILD_ID" ]]; then
  cmp -s "$DIST/BUILD_ID" "$STANDALONE/.next/BUILD_ID" || fail "BUILD_ID mismatch between dist and standalone"
fi

rm -rf "$STATIC_DST"
mkdir -p "$(dirname "$STATIC_DST")"
cp -a "$STATIC_SRC" "$STATIC_DST"
chmod -R o+rX "$STATIC_DST"

[[ -d "$STATIC_DST/chunks" ]] || fail "copy produced no chunks dir at $STATIC_DST"
DST_COUNT="$(find "$STATIC_DST" -type f ! -name '.gitkeep' | wc -l | tr -d ' ')"
[[ "$DST_COUNT" -ge "$CHUNK_COUNT" ]] || fail "static copy lost files (src=$CHUNK_COUNT dst=$DST_COUNT)"

if [[ -x "$ROOT/scripts/nex-atomic-deploy-check.sh" ]]; then
  bash "$ROOT/scripts/nex-atomic-deploy-check.sh" --standalone "$STANDALONE"
fi

echo "STANDALONE FINALIZE OK (static files=$DST_COUNT, chunks src=$CHUNK_COUNT)"