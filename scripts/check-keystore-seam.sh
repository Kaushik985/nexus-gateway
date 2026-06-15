#!/usr/bin/env bash
# Enforce the platform-keystore seam: keystore.NewPlatformStore() opens the
# REAL macOS Keychain / Windows DPAPI. Under `go test` on a developer machine
# that pops an OS authorization dialog and couples tests to host state, so
# the platform store may be constructed in exactly ONE place — the agent's
# composition root — and everything downstream takes keystore.Store as a
# parameter (tests inject keystore.NewMemoryStore()).
#
# Allowed: packages/agent/cmd/agent/cmd_run.go (composition root) and the
# keystore package itself (definition + per-OS impls + its own tests, which
# exercise only the memory store by convention reviewed there).
set -uo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Composition roots: the run + enroll subcommand entry files.
violations=$(grep -rn "NewPlatformStore(" packages/ tools/ --include='*.go' 2>/dev/null \
  | grep -v "^packages/agent/cmd/agent/cmd_run.go:" \
  | grep -v "^packages/agent/cmd/agent/cmd_enroll.go:" \
  | grep -v "^packages/agent/internal/identity/keystore/" || true)

if [[ -n "$violations" ]]; then
  echo "✗ platform-keystore seam violated — NewPlatformStore() outside the composition root:"
  echo "$violations" | sed 's/^/    /'
  echo "  Construct the platform store ONLY in cmd_run.go and pass keystore.Store down;"
  echo "  tests must inject keystore.NewMemoryStore() (real Keychain/DPAPI prompts under go test)."
  exit 1
fi
echo "[check-keystore-seam] platform keystore constructed only at the composition root ✓"
