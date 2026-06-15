# Core-path 100% coverage gate

The four core traffic/queue chains are performance- and correctness-critical:

1. **ai-gateway traffic chain** — the traffic_event/audit writer.
2. **desktop-agent traffic chain** — NE/WFP flow decision + process lookup + the SQLite audit-queue drain.
3. **compliance-proxy traffic chain** — MITM forward + audit MQ writer.
4. **hub data consume + persist chain** — MQ consumers, traffic ingest, queue drains.

A dropped branch in their hot path is a billing / compliance / availability defect, and concurrency correctness (no data race, no cross-flow bleed, fail-open) is only trustworthy when every branch is exercised. The repo-wide gate is **≥95% per package** (`scripts/check-go-coverage.sh`), but those packages are often on the OS-bound coverage allowlist (e.g. `agent/internal/platform/darwin`), so a package-level gate would never catch a regression in a single hot-path function.

## The gate

`scripts/check-core-path-coverage.sh` enforces **100% statement coverage** on a curated list of **functions** (not packages) — finer-grained than, and stricter than, the package gate, and **not waivable by the OS allowlist**.

- **Manifest**: `scripts/.core-path-100` — one `<module-relative-package-dir> <FuncName>` per line. Adding or removing an entry **requires explicit user approval** (same discipline as `scripts/.coverage-allowlist`).
- **Granularity**: per-function, via `go tool cover -func`.
- **OS-tagged packages**: a package that does not build on the current GOOS (darwin/linux/windows) is **skipped** with a notice — darwin entries are enforced on the macOS pre-commit hook; OS-neutral entries (ai-gateway audit, agent queue) are enforced everywhere, including Linux CI.

## Where it runs

- **pre-commit** (`.githooks/pre-commit`): runs whenever a `.go` file, the manifest, or the checker is staged — on the developer's machine, so darwin functions are checked there.
- **CI** (`.github/workflows/go-ci.yml` → `core-path-coverage` job, Linux): enforces the OS-neutral functions on every PR. This is the non-bypassable backstop — `git commit --no-verify` skips the local hook, but the CI job does not.
- **npm**: `npm run check:coverage:core` (also part of `check:all`).

## Adding a core-path function

When a new function lands on one of the four chains (or an existing one is split), add it to `scripts/.core-path-100` **with user approval**, write tests that take it to 100% (including the concurrency/data-flow tests required for the lock-free paths — see [[feedback-core-path-high-performance]]), and confirm `npm run check:coverage:core` is green.
