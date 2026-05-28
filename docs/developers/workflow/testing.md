# Testing

This is the developer workflow for testing a change: which tier to run, when,
and what counts as "done". For the design of the harness — the rationale behind
the pyramid, the orchestrator internals, and the environment-file contract — see
[test-harness-architecture.md](../architecture/cross-cutting/observability/test-harness-architecture.md).

## The tiers

Tests are layered as a pyramid: a broad, fast, deterministic base and
progressively narrower, slower, higher-fidelity tiers above it.

| Tier | Where | Run it with | Proves |
|------|-------|-------------|--------|
| Unit | each Go package | `go test -cover -count=1 ./...` | logic in isolation; ≥95% gate |
| L1 smoke | `tests/smoke/` | `bash tests/smoke/run-all.sh` | endpoints answer, DB rows land (Bash + curl + psql) |
| L1 Go integration | `tests/integration-go/` | `cd tests/integration-go && go test ./...` | cross-package wiring against live services |
| L2 protocol | `tests/e2e-python/protocol/` | `cd tests/e2e-python && uv run pytest protocol/` | OpenAI/Anthropic SDK round-trips |
| L3 AI-judge | `tests/e2e-python/ai_judge/` | `cd tests/e2e-python && uv run pytest ai_judge/` | response quality via an LLM verdict |
| L4 UI E2E | `tests/e2e-ui/` | `cd tests/e2e-ui && npx playwright test` | the Control Plane UI in a browser |
| L5 scenarios | `tests/scenarios/` | `cd tests/scenarios && NEXUS_TEST_TARGET=local GOWORK=off go test -count=1 .` | business flows end-to-end |

Each L5 scenario asserts a full business flow: the HTTP response shape, a
database cross-check, the runtime hot-reload signal, an admin-audit-log row, and
a Prometheus counter delta where applicable. The scenario set is cataloged in
`tests/scenarios/00-catalog.md`.

## The orchestrator

`tests/run-all.sh` runs the tiers and writes a unified markdown report to
`$NEXUS_TEST_LOG_DIR/test-all-<UTC>.md` (default under `/tmp/nexus-test/`), with
per-phase pass/fail and the last lines of any failed phase's log. Modes:

- `--quick` — L1 smoke + L1 Go integration + the single harness-validating
  scenario. The fast deterministic tier.
- `--core` — adds roughly ten high-priority scenarios, one per major family; a
  few-minute sweep between `--quick` and `--full`.
- `--full` — every phase, including the L2/L3 Python tiers, L4 UI, and the full
  scenario sweep.
- `--blocking` — the release-gate profile, **run manually around a release
  (human-controlled, not an automatic CI/CD gate)**: L1 smoke + the core
  one-per-family scenarios + a bounded-model AI Gateway smoke
  (`NEXUS_BLOCKING_MODELS`). Real upstream; a red verdict means a real bug, so
  the operator holds the release.
- `--nightly` — the broad on-demand profile: the full scenario sweep + the
  heavyweight Go-integration / Playwright / Python tiers + the full-surface
  `smoke-gateway --all-ingress`.
- `--phase <smoke|go|ui|ai-judge|protocol>` — one phase in isolation.

The runner also emits an informational coverage-matrix snapshot at the end; the
matrix itself is enforced as a PR-time gate, not a per-run gate. The two
release-gate profiles draw their membership from
[e2e-coverage-matrix.md](../specs/e2e-coverage-matrix.md): a **red** verdict
(our own behavior wrong on a successful upstream call) blocks, while an upstream
`5xx` or timeout is **amber** and only alerts.

## Setup

Bring the stack up first with `./scripts/dev-start.sh`. The runner's preflight
(`tests/lib/preflight.sh`) then verifies every dependency before any phase runs:
Postgres up with the `Provider` table seeded, the Hub healthy and answering its
admin API, the Control Plane accepting the seeded admin login, the AI Gateway
serving `/v1/models` with `NEXUS_TEST_VK` (when set), and the Compliance Proxy
listening.

Configuration comes from `tests/.env.<target>`, loaded by `tests/lib/loadenv.sh`;
`NEXUS_TEST_TARGET` selects `local`, `dev`, or `prod` (defaulting to `local` on a
TTY), and `NEXUS_TEST_VK` must be a real virtual key. The full loader contract and
the fail-closed safety guards are in
[local-dev-debugging.md](local-dev-debugging.md). The shared Bash helpers used
across the tiers live in `tests/lib/` (`assert.sh`, `db.sh`, `auth.sh`,
`http.sh`, and the loader).

## What to run for a change

Match the tier to the blast radius:

- **Always** — the unit tests for the package(s) you touched, under the ≥95%
  coverage gate. The pre-commit hook runs the gate on staged Go packages
  automatically (see [coverage-allowlist-methodology.md](coverage-allowlist-methodology.md)).
- **AI Gateway / `traffic_event` / codec / cache / normalize / adapter change** —
  run `tests/scripts/smoke-gateway.py`. Use `--all-ingress` for the full
  surface; a scoped run (`--models …`, or a single ingress) is acceptable only
  when the blast radius is provably narrow, and the scoping decision must be
  called out.
- **Business-flow change** — the matching L5 scenario(s).
- **Before a PR** — `bash tests/run-all.sh --full` (or `--core` for a faster
  sweep) as the "did I break something" gate.
- **Around a release** — `bash tests/run-all.sh --blocking` is the release-gate
  profile, run **manually** by the operator (it is intentionally not an
  automatic CI/CD gate); a red verdict holds the release.

## Binding rules

- **Verification rule.** Every test must verify reality through at least one of:
  an HTTP response assertion, a DB cross-check, a Prometheus counter delta, or an
  AI-judge verdict. A test that only checks "the binary returned without
  erroring" is not acceptable.
- **Unit coverage ≥95% per Go package.** Enforced by the coverage gate; see
  [coverage-allowlist-methodology.md](coverage-allowlist-methodology.md).
- **L5 scenario landing rule.** A new `tests/scenarios/*_test.go` cannot land on
  `go vet` / `go test -c` evidence alone — the PR must include a live run
  (`cd tests/scenarios && NEXUS_TEST_TARGET=local GOWORK=off go test -run ^Test<NNN>$ -count=1 -v`)
  showing `--- PASS` or `--- SKIP`, where a skip cites a concrete architectural or
  environment precondition.
- **AI Gateway smoke mandatory.** A change in the AI Gateway blast radius above
  must run the gateway smoke before the work is reported done.
- **Scenario harness is fail-closed.** It requires `NEXUS_TEST_TARGET=local` for
  non-interactive runs and allowlists `localhost` only, so a stray production
  hostname cannot turn a state-mutating scenario against prod.

## References

- `tests/run-all.sh` — the orchestrator
- `tests/README.md` — quick start and the per-tier run commands
- `tests/lib/` — shared loader, assert, db, auth, http, and preflight helpers
- `tests/scenarios/` — L5 business-flow scenarios and their catalog
- `tests/scripts/smoke-gateway.py` — the full-surface AI Gateway smoke
- `scripts/dev-start.sh` — local stack bring-up
- [test-harness-architecture.md](../architecture/cross-cutting/observability/test-harness-architecture.md) — the harness design
- [coverage-allowlist-methodology.md](coverage-allowlist-methodology.md) — the unit-coverage gate
- [local-dev-debugging.md](local-dev-debugging.md) — the test env-file contract
