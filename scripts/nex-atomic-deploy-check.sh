#!/usr/bin/env bash
# Fail-closed gates for Next.js standalone atomic deploy.
# Incomplete static (the #5/#8 pattern: server.js present, chunks missing)
# must never be announced as green.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE=""
CHECK_READINESS=0
READINESS_URL="${NEX_READINESS_URL:-http://127.0.0.1:3211/health/readiness}"
SAMPLE_CHUNK_URL="${NEX_SAMPLE_CHUNK_URL:-}"

usage() {
  cat <<'EOF'
Usage: scripts/nex-atomic-deploy-check.sh [options]

Fail-closed artifact gates for Next.js `output: "standalone"`.
Do not start or announce deploy OK unless this script exits 0.

Options:
  --root DIR            Repository / build root (default: repo root)
  --standalone DIR      Standalone dir (default: <root>/.next/standalone)
  --readiness [URL]     After start: require HTTP 200 from readiness
                        (default URL: http://127.0.0.1:3211/health/readiness)
  --sample-chunk URL    After start: require HTTP 200 from a /_next/static/ URL
  -h, --help            Show this help

Environment:
  NEX_READINESS_URL     Override default readiness URL
  NEX_SAMPLE_CHUNK_URL  Override / default sample chunk URL
  NEX_CHECK_READINESS=1 Same as --readiness
EOF
}

fail() {
  echo "ATOMIC DEPLOY CHECK FAILED: $*" >&2
  exit 1
}

ok() {
  echo "OK: $*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || fail "--root requires a directory"
      ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    --standalone)
      [[ $# -ge 2 ]] || fail "--standalone requires a directory"
      STANDALONE="$2"
      shift 2
      ;;
    --readiness)
      CHECK_READINESS=1
      if [[ $# -ge 2 && "$2" != -* ]]; then
        READINESS_URL="$2"
        shift 2
      else
        shift
      fi
      ;;
    --sample-chunk)
      [[ $# -ge 2 ]] || fail "--sample-chunk requires a URL"
      SAMPLE_CHUNK_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

if [[ -n "${NEX_CHECK_READINESS:-}" && "${NEX_CHECK_READINESS}" != "0" ]]; then
  CHECK_READINESS=1
fi

if [[ -z "$STANDALONE" ]]; then
  STANDALONE="${ROOT}/.next/standalone"
fi

# Allow a relative standalone path from the current working directory or root.
if [[ ! -d "$STANDALONE" && -d "${ROOT}/${STANDALONE}" ]]; then
  STANDALONE="${ROOT}/${STANDALONE}"
fi

SERVER_JS="${STANDALONE}/server.js"
STATIC_DIR="${STANDALONE}/.next/static"

echo "==> atomic deploy check"
echo "    root=${ROOT}"
echo "    standalone=${STANDALONE}"

# --- Gate 1: standalone server entry ---
if [[ ! -f "$SERVER_JS" ]]; then
  fail "missing ${SERVER_JS} — standalone output is incomplete; run pnpm build and do not announce green"
fi
ok "standalone server.js present"

# --- Gate 2: static tree exists and has files (the #5/#8 hole) ---
if [[ ! -d "$STATIC_DIR" ]]; then
  fail "missing ${STATIC_DIR} — copy .next/static into standalone before start (incomplete #5/#8). Do not announce green."
fi

mapfile -t STATIC_FILES < <(find "$STATIC_DIR" -type f ! -name '.gitkeep' | sort)
STATIC_COUNT="${#STATIC_FILES[@]}"
if [[ "$STATIC_COUNT" -le 0 ]]; then
  fail "${STATIC_DIR} has 0 files — static copy was skipped or empty (incomplete #5/#8). Do not announce green."
fi
ok "standalone static file count=${STATIC_COUNT}"

# --- Gate 3: HTML-referenced assets, or css + main-app chunk patterns ---
html_refs_found=0
missing_refs=0
declare -a MISSING_REF_PATHS=()

collect_html_refs() {
  local search_root="$1"
  [[ -d "$search_root" ]] || return 0
  local html
  while IFS= read -r html; do
    local ref
    while IFS= read -r ref; do
      # grep may keep a trailing \ from escaped quotes in RSC/JSON (e.g. .woff2\").
      ref="${ref#"${ref%%[![:space:]]*}"}"
      ref="${ref%"${ref##*[![:space:]]}"}"
      ref="${ref%\\}"
      ref="${ref%"${ref##*[![:space:]]}"}"
      [[ -n "$ref" ]] || continue
      html_refs_found=1
      local rel="${ref#/_next/static/}"
      local on_disk="${STATIC_DIR}/${rel}"
      if [[ ! -f "$on_disk" ]]; then
        missing_refs=1
        MISSING_REF_PATHS+=("$ref -> ${on_disk}")
      fi
    done < <(grep -oE '/_next/static/[^"'\''[:space:]?]+' "$html" || true)
  done < <(find "$search_root" -type f \( -name '*.html' -o -name '*.rsc' \) 2>/dev/null | sort)
}

collect_html_refs "${STANDALONE}/.next/server"
if [[ "$html_refs_found" -eq 0 ]]; then
  collect_html_refs "${ROOT}/.next/server"
fi

css_matches="$(find "$STATIC_DIR" -type f \( -name '*.css' -o -path '*/css/*' \) | wc -l | tr -d ' ')"
main_app_matches="$(find "$STATIC_DIR" -type f \( -name '*main-app*' -o -name 'main-app-*.js' \) | wc -l | tr -d ' ')"
chunk_matches="$(find "$STATIC_DIR" -type f \( -name '*.js' -o -path '*/chunks/*' \) | wc -l | tr -d ' ')"

if [[ "$html_refs_found" -eq 1 ]]; then
  if [[ "$missing_refs" -ne 0 ]]; then
    printf '%s\n' "${MISSING_REF_PATHS[@]}" >&2
    fail "built HTML/RSC references /_next/static/ files that are absent under ${STATIC_DIR} (incomplete #5/#8). Do not announce green."
  fi
  ok "built HTML/RSC static references exist on disk"
else
  if [[ "$css_matches" -le 0 || "$main_app_matches" -le 0 ]]; then
    fail "${STATIC_DIR} lacks css+main-app chunk patterns (css=${css_matches} main-app=${main_app_matches} js/chunks=${chunk_matches}). Copy .next/static into standalone. Do not announce green."
  fi
  ok "css+main-app chunk patterns present (css=${css_matches} main-app=${main_app_matches})"
fi

# Even when HTML refs resolve, require a non-empty JS/CSS payload so a
# single leftover file cannot pass the gate.
if [[ "$css_matches" -le 0 && "$chunk_matches" -le 0 ]]; then
  fail "${STATIC_DIR} has files but no css or js chunks — refuse green"
fi

# --- Optional post-start gates ---
http_status() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 5 "$url" || echo "000"
}

if [[ "$CHECK_READINESS" -eq 1 ]]; then
  code="$(http_status "$READINESS_URL")"
  if [[ "$code" != "200" ]]; then
    fail "readiness ${READINESS_URL} returned ${code} (want 200). Do not announce green."
  fi
  ok "readiness 200 ${READINESS_URL}"
fi

if [[ -n "$SAMPLE_CHUNK_URL" ]]; then
  code="$(http_status "$SAMPLE_CHUNK_URL")"
  if [[ "$code" != "200" ]]; then
    fail "sample chunk ${SAMPLE_CHUNK_URL} returned ${code} (want 200). Static may be missing at the edge. Do not announce green."
  fi
  ok "sample chunk 200 ${SAMPLE_CHUNK_URL}"
elif [[ "$CHECK_READINESS" -eq 1 && "$STATIC_COUNT" -gt 0 ]]; then
  sample_rel="${STATIC_FILES[0]#${STATIC_DIR}/}"
  derived="http://127.0.0.1:3211/_next/static/${sample_rel}"
  code="$(http_status "$derived")"
  if [[ "$code" != "200" ]]; then
    fail "derived sample chunk ${derived} returned ${code} (want 200). Do not announce green."
  fi
  ok "sample chunk 200 ${derived}"
fi

echo "==> atomic deploy check PASSED (not green until every gate above is OK)"
