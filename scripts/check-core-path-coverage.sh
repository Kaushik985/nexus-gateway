#!/usr/bin/env bash
#
# check-core-path-coverage.sh — enforce 100% statement coverage on the
# core traffic/queue-chain functions listed in scripts/.core-path-100.
#
# This is STRICTER than check-go-coverage.sh (>=95% per package) and is
# NOT waivable by the OS-bound coverage allowlist: the listed functions
# live in performance/correctness-critical hot paths (often inside
# allowlisted packages), so a dropped branch there is a real defect the
# package-level gate cannot see.
#
# Per-function granularity via `go tool cover -func`. A package that does
# not build on the current GOOS (OS-tagged darwin/linux/windows) is
# SKIPPED with a notice — darwin entries are enforced on macOS, OS-neutral
# entries everywhere.
#
# bash 3.2 compatible (macOS) — no associative arrays.
#
# Usage: scripts/check-core-path-coverage.sh
# Exit 0 = all listed functions at 100%; non-zero = at least one below.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

MANIFEST="$REPO_ROOT/scripts/.core-path-100"
if [[ ! -f "$MANIFEST" ]]; then
  echo "[core-path-100] manifest $MANIFEST not found" >&2
  exit 2
fi

# Normalised manifest: "<pkgdir> <func>" lines, comments/blanks stripped.
CLEAN="$(mktemp)"
trap 'rm -f "$CLEAN"' EXIT
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(echo "$line" | xargs 2>/dev/null)"
  [[ -z "$line" ]] && continue
  echo "$line"
done < "$MANIFEST" > "$CLEAN"

# Find the module root (nearest ancestor dir with go.mod) for a package dir.
module_root_for() {
  local dir="$1"
  while [[ "$dir" != "$REPO_ROOT" && "$dir" != "/" ]]; do
    [[ -f "$dir/go.mod" ]] && { echo "$dir"; return 0; }
    dir="$(dirname "$dir")"
  done
  [[ -f "$REPO_ROOT/go.mod" ]] && { echo "$REPO_ROOT"; return 0; }
  return 1
}

FAIL_COUNT=0
OK_COUNT=0
SKIP_COUNT=0
FAIL_MSGS=""
GOOS="$(go env GOOS)"

# Iterate unique package dirs.
for pkgdir in $(awk '{print $1}' "$CLEAN" | sort -u); do
  abs="$REPO_ROOT/$pkgdir"
  if [[ ! -d "$abs" ]]; then
    FAIL_COUNT=$((FAIL_COUNT+1)); FAIL_MSGS+="    $pkgdir → directory missing"$'\n'; continue
  fi
  modroot="$(module_root_for "$abs")" || {
    FAIL_COUNT=$((FAIL_COUNT+1)); FAIL_MSGS+="    $pkgdir → no go.mod ancestor"$'\n'; continue
  }
  relpkg="./${abs#"$modroot"/}"

  prof="$(mktemp)"
  build_out="$(cd "$modroot" && GOWORK=off go test -covermode=set -coverprofile="$prof" "$relpkg" 2>&1)"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    if echo "$build_out" | grep -qiE "build constraints exclude all Go files|no Go files|cannot find package|no test files|matched no packages"; then
      SKIP_COUNT=$((SKIP_COUNT+1)); echo "  - skip: $pkgdir (not buildable/testable on $GOOS)"
      rm -f "$prof"; continue
    fi
    FAIL_COUNT=$((FAIL_COUNT+1)); FAIL_MSGS+="    $pkgdir → test build/run failed: $(echo "$build_out" | tail -1)"$'\n'
    rm -f "$prof"; continue
  fi

  func_out="$(cd "$modroot" && go tool cover -func="$prof" 2>/dev/null)"
  rm -f "$prof"

  # Each func wanted for this pkgdir.
  for func in $(awk -v p="$pkgdir" '$1==p{print $2}' "$CLEAN"); do
    pct="$(echo "$func_out" | awk -v f="$func" '$2==f{print $3}' | tail -1)"
    if [[ -z "$pct" ]]; then
      FAIL_COUNT=$((FAIL_COUNT+1)); FAIL_MSGS+="    $pkgdir $func → not found in coverage (renamed/removed? update the manifest with approval)"$'\n'
    elif [[ "$pct" != "100.0%" ]]; then
      FAIL_COUNT=$((FAIL_COUNT+1)); FAIL_MSGS+="    $pkgdir $func → $pct (must be 100.0%)"$'\n'
    else
      OK_COUNT=$((OK_COUNT+1))
    fi
  done
done

echo "[core-path-100] ${OK_COUNT} function(s) at 100%; ${SKIP_COUNT} package(s) skipped (OS-gated); ${FAIL_COUNT} failing"
if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "✗ core-path 100% coverage FAILED:" >&2
  printf '%s' "$FAIL_MSGS" >&2
  echo "  These are core traffic/queue-chain hot paths and must stay 100% covered." >&2
  echo "  See scripts/.core-path-100 (changing the list needs explicit user approval)." >&2
  exit 1
fi
echo "✓ all core-path functions at 100%"
