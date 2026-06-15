# Coverage allowlist methodology

Every Go package in `packages/**` must reach **≥95% statement coverage** under
`go test -cover -count=1 ./...`, or be listed in `scripts/.coverage-allowlist`
with a concrete category and rationale. Adding an allowlist entry requires
explicit user approval, and the long-term goal is an empty allowlist. This page
is the canonical methodology: how the gate works, the six exemption categories,
the five-step audit for bringing a package into compliance, and the testability
seams that have proven out in this repo.

The threshold is about *quality* tests, not a percentage. Tests must assert
observable business behavior and named failure modes — calling a function only
to bump the number, or asserting nothing beyond `err == nil`, defeats the rule
even when the percentage clears 95. Core business logic is held to a higher bar:
100%.

## The gate

`scripts/check-go-coverage.sh` is the single enforcer. It discovers every Go
module (each `packages/*/go.mod`), runs `go test -cover -count=1 ./...` per
module, and classifies every package from the test output:

- `coverage: N% of statements` — compared against the threshold (default 95).
- `coverage: [no statements]` — a pure type-definition or doc-only package with
  no logic to test; counted as passing.
- `[no test files]` — a package that has logic but no tests; a **failure** unless
  allowlisted.
- `FAIL` — a test failure. A blocker for a normal package; for an allowlisted
  package (typically DB-bound, where a stale local schema breaks the run) it is
  surfaced as a tolerated warning rather than a block, because the rule is about
  the threshold, not about whether external infrastructure is available locally.

Allowlist matching is a shell-style glob (`*`, `?`, `[abc]`) of each line in
`scripts/.coverage-allowlist` against the package import path.

**Import-path extraction caveat.** A package with no test functions prints its
coverage line beginning with a tab (`\t<import>\t\tcoverage: 0.0% of
statements`), so the import path is *not* the first whitespace field. The script
extracts it by matching the `github.com/` token — never by tab/space field
position. An earlier version read "field 1", got an empty string on this shape,
and silently dropped every test-less package, so untested non-allowlisted
packages passed the gate while it reported a smaller package count than actually
exist. To detect such drift, compare the script's reported count against a full
sweep: `for m in packages/*/; do (cd "$m" && go test -cover ./... 2>/dev/null);
done | grep -c 'coverage:'` should equal the gate's "packages checked".

The script takes a few flags:

- *(no flag)* — check every package; the CI default.
- `--staged` — restrict to modules with staged `.go` files; the pre-commit
  scope. Exits cleanly when nothing relevant is staged.
- `--threshold=N` — advisory override; the binding threshold stays 95.
- `--json` — machine-readable `{threshold, failed[], ok_count}`.
- `--strict-allowlist` — additionally report allowlisted packages that now clear
  the threshold and can be removed, so the allowlist trends toward empty.

## Where it runs

- **Pre-commit.** `.githooks/pre-commit` runs `check-go-coverage.sh --staged`
  whenever any `.go` file is staged, as a hard guard that blocks the commit. The
  hook path is wired by `git config core.hooksPath .githooks`, set from the root
  `prepare` npm script — there is no husky layer.
- **Full sweep.** `npm run check:coverage` runs the whole repo, and it is part
  of `npm run check:all`; CI fails on any threshold miss.
- **Prune sweep.** `npm run check:coverage:strict` runs with
  `--strict-allowlist` to surface removable entries.

## The exemption categories

`scripts/.coverage-allowlist` holds one glob pattern per line. Each entry must
cite one of six categories in a trailing comment, and each addition requires
user approval:

- **(A) `cmd/*` entry point.** `main()` wiring that parses flags, calls boot,
  and waits on a signal — it calls `os.Exit` and depends on real signal
  delivery, so it cannot be unit-tested in isolation. The per-service DI-assembly
  `wiring` packages sit here too, exercised to the limit unit tests can reach
  with the integration-bound remainder covered end-to-end. An entry package that
  accumulates real business logic is *not* category A — extract that logic into a
  sibling package that is subject to the gate (as `cmd/ai-gateway/configdispatch`
  and `cmd/control-plane/configdispatch` do).
- **(B) Test helper.** Packages imported only from other packages' `_test.go`
  (for example `bufconn`, `idptest`, `storetest`, `testutil`). Verify with a grep
  for importers — a single production importer disqualifies it.
- **(C) DB-bound.** Tests require a live PostgreSQL; without it the package
  reports 0%. This is a *last resort*: most store packages reach 95%+ with the
  `PgxPool`/`pgxmock` seam below and need no exemption.
- **(D) OS-bound.** Tests need kernel APIs, the system keychain, packet capture,
  WinDivert, or a built Wails frontend embed (for example the agent keystore,
  tray IPC, platform shims, and the Wails UI entry).
- **(E) Network-infra-bound.** Tests need real S3, NATS JetStream, Valkey
  Sentinel, or a live TLS handshake (for example the S3 spill store, the MQ
  client, and the TLS-bump engine). Only the genuine connection/handshake code
  warrants the exemption — pure protocol logic (SNI parsing, key construction,
  error mapping, message framing) is mockable and must be covered.
- **(F) Integration-only.** The package's tests live behind a build tag; the
  concrete logic is tested in OS-specific sub-packages while the root only
  re-exports.

The bottom of the allowlist file carries breadcrumbs for the proven seam
patterns below — those lines are documentation, not active exemptions.

**`BACKFILL-PENDING` section.** A coverage program may temporarily list a batch
of under-tested packages under a clearly-labelled `BACKFILL-PENDING` heading to
keep the gate green while it writes real tests. Those entries are explicitly
*not* legitimate exemptions; every one must leave the section once its package
crosses the threshold, and the section must reach zero.

## The five-step audit

When a package is below threshold, work it in this order:

1. **Measure.** Run the gate (`npm run check:coverage`, or `--json` for a
   parseable list) to see exactly which packages and percentages are short.
2. **Classify the residual.** Look at the *uncovered* lines, not the package as
   a whole. Decide whether they are business logic that should be tested, or a
   genuine integration boundary that belongs in one of categories A–F.
3. **Apply a testability seam.** If the logic is reachable but coupled to
   infrastructure, introduce a seam (see below) so a fake can stand in for the
   dependency — coupling that blocks a test is itself a defect to fix, not a
   reason to exempt. Mocking exists precisely to reach what real resources block.
4. **Write behavior-asserting tests.** Cover the logic with tests that assert
   observable outputs and named failure modes, not padding.
5. **Allowlist only the true residual.** Whatever is left that genuinely needs
   live infrastructure or an OS API gets an allowlist line with its category, a
   one-line rationale, and user approval. Re-run `--strict-allowlist` later to
   prune entries that have since crossed the threshold.

## Proven testability seams

Three seams have repeatedly converted infrastructure-coupled code into unit-
testable code in this repo:

- **Seam 1 — the `PgxPool` interface.** A store package that holds a
  `*pgxpool.Pool` directly is DB-coupled, so `go test` reports 0% without a live
  PostgreSQL. Declare a narrow `PgxPool` interface in the production file — the
  four methods the pool already exposes (`Begin`, `Exec`, `Query`, `QueryRow`) —
  and depend on that. The concrete `*pgxpool.Pool` satisfies it unchanged in
  production, while tests drive the store with `pgxmock`, asserting the SQL and
  the row mapping. This is the most-applied seam: it takes a store package from
  0% / DB-bound to well past 95% with no infrastructure. Note pgxmock treats a
  missing `WithArgs` as "expect zero args" — use `WithArgs(pgxmock.AnyArg(), …)`
  for queries whose exact args aren't the assertion, or the expectation silently
  fails to match and the test passes for the wrong reason.
- **Seam 2 — a narrow interface or injectable var in the production file.** When
  a function reaches out to a service client, extract a small interface for just
  the methods it uses, or expose the constructor as a package-level variable, so
  a test can substitute a fake (as the compliance-proxy break-glass probe does).
- **Seam 3 — `doc_test.go` for type-only packages.** A package that is purely
  type definitions or sentinel constants reports `[no test files]`, which the
  gate treats as a failure. Adding a `doc_test.go` (a package-level test file
  with no assertions needed) turns the report into `[no statements]`, which the
  gate honestly skips — there is no logic to cover.

## Carve-outs that are not allowed

- *"The test would be slow."* Slow tests still count; move them behind a build
  tag as an integration test (category F).
- *"We'll add tests later."* "Later" is not a category — an allowlist entry
  needs a real category now.
- *"The code is too coupled."* Tight coupling that prevents a test is a defect;
  refactor it with a seam.

## Frontend coverage gate (Vitest)

The frontend carries the **same policy as Go — core business logic 100%,
overall 95%** — enforced by Vitest's native per-package `test.coverage`
thresholds (V8 provider) and surfaced through `scripts/check-ui-coverage.sh`
(wired into `npm run check:all` as `check:coverage:ui`, alongside the Go
`check:coverage`). Three workspaces, each with its own config block:

| Package | Config | Baseline (stmts, source only) |
|---|---|---|
| `packages/control-plane-ui` | `vite.config.ts` | 32.8% (~19k stmts) |
| `packages/ui-shared` | `vitest.config.ts` | 51.5% → 100% |
| `packages/agent/ui/frontend` (Agent dashboard) | `vite.config.ts` | 15.6% |

**Test file location (binding).** Frontend unit tests live under each package's
`tests/` directory, mirroring the `src/` tree — e.g. the test for
`src/pages/metrics/metrics-aggregates-helpers.ts` is
`tests/pages/metrics/metrics-aggregates-helpers.test.ts`. Tests are **not**
co-located with source. Because a test under `tests/` is one level outside
`src/`, its relative `import` / dynamic-`import()` / `vi.mock()` specifiers point
back into source (`../../src/...`); `@/...` alias imports (control-plane-ui,
agent/ui) are location-independent and preferred. The `src/test/` harness
(setup, MSW, test-utils) stays in `src/` and is referenced via the config's
`setupFiles` + the `@/test/...` alias. Playwright E2E specs stay in `e2e/`.

Every config's `coverage.exclude` lists `**/*.test.{ts,tsx}` so a stray test
file can never be counted as source — a test under `src/**` would otherwise
inflate the denominator at ~100% (this exact bug had padded the Agent dashboard
~15.6%→21.3% while its tests were co-located).

**Mechanism, mapped to the Go gate:**

- **`coverage.include: ['src/**']`** counts *every* source file (an untested
  file is 0%, not invisible) — the honest denominator, the Vitest equivalent of
  the Go gate checking every package.
- **`coverage.exclude` is the allowlist.** Only genuinely un-coverable-in-unit-
  scope surfaces belong there — app bootstrap (`main.tsx`, `ReactDOM.createRoot`
  on a real DOM), `*.d.ts`, Storybook `*.stories.tsx`, and the test harness
  (`src/test/**`, MSW handlers), and imported JSON resource bundles
  (`src/**/*.json` — no executable statements; Vitest 4's V8 provider counts
  imported JSON modules, which only distorts the denominator). Adding an
  exclude needs the same A–F-grade justification as a Go allowlist entry.
- **`coverage.thresholds` is the gate.** Today they are a **regression-guard
  ratchet at the current baseline** (so develop stays green while the backfill
  runs — the same move as the Go gate's now-emptied BACKFILL-PENDING section),
  plus higher per-directory floors on the core business-logic dirs that already
  meet them (`src/hooks` 95, `src/auth` 84, `src/lib`/`src/api`). **Raise the
  floors as coverage lands; never lower them.** One exception: a coverage
  *instrument* change — a Vitest major whose V8 remapping counts a different
  statement/branch population for the same code and tests — re-pins the floors
  at the newly measured honest baseline in the same PR as the upgrade (numbers
  may move in either direction; any metric that measures higher ratchets up).

**Burn-down (the remaining work).** The bulk of the gap is presentational —
`control-plane-ui/src/pages` (27.7%, ~14.5k stmts) and `src/components`
(37.5%) — plus the barely-tested Agent dashboard. Backfilling these to the 95%
target is a large, multi-PR effort that follows the Go backend's pattern:
business-asserting tests (render + interaction + state assertions via Testing
Library, MSW for the API layer), never snapshot/padding. The core logic dirs
(`api`, `lib`, `hooks`, `auth`, `state`) are the 100% target and the priority.

## References

- `scripts/check-go-coverage.sh` — the coverage gate (Go)
- `scripts/check-ui-coverage.sh` — the coverage gate (frontend Vitest)
- `scripts/.coverage-allowlist` — exemption list, categories, seam breadcrumbs
- `.githooks/pre-commit` — staged-scope pre-commit enforcement
- `.cursor/rules/unit-test-coverage-95.mdc` — IDE-side surfacing of the rule
- `packages/control-plane/internal/ai/providers/modelstore/model_pgxmock_test.go` — `PgxPool` + pgxmock exemplar
- `packages/shared/policy/decision/doc_test.go` — `doc_test.go` no-statements seam
