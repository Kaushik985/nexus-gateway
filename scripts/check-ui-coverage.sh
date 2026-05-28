#!/usr/bin/env bash
# Frontend coverage gate — the Vitest parallel of scripts/check-go-coverage.sh.
#
# Runs each UI workspace's Vitest suite with V8 coverage and lets Vitest enforce
# the per-package thresholds declared in its config's test.coverage.thresholds.
# Policy (same as Go): core business logic 100%, overall 95%. The enforced
# thresholds are a regression-guard RATCHET at the current baseline; the
# presentational backfill toward 95% is the documented burn-down. See the
# "Frontend coverage gate" section of
# docs/developers/workflow/coverage-allowlist-methodology.md.
#
# The per-package coverage.exclude lists are the frontend allowlist: only
# genuinely un-coverable-in-unit-scope surfaces (app bootstrap main.tsx, *.d.ts,
# Storybook stories, the test harness). Adding an exclude requires the same
# justification bar as a Go allowlist entry.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

# Each UI workspace ships its own vitest config with a test.coverage block.
ui_packages=(
  "packages/control-plane-ui"
  "packages/ui-shared"
  "packages/agent/ui/frontend"
)

fail=0
for pkg in "${ui_packages[@]}"; do
  echo "[check-ui-coverage] ── $pkg"
  if ! (cd "$root/$pkg" && npx vitest run --coverage --coverage.provider=v8); then
    echo "[check-ui-coverage] ✗ $pkg below its coverage thresholds"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "[check-ui-coverage] FAIL — a UI package regressed below its coverage floor"
  exit 1
fi
echo "[check-ui-coverage] all UI packages meet their coverage thresholds ✓"
