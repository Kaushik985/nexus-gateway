---
name: oss-secret-scan
description: >
  Scan the repository for leaked secrets, PII, and production infrastructure
  before an open-source release — public IPs, non-allowlisted domains,
  emails/usernames, passwords, API keys, private keys, DB connection strings,
  device serials / fingerprints / machine IDs, EC2 internal hostnames. The
  detection is a deterministic Python script (regex + entropy + allowlist) so
  an LLM drifting cannot cause a missed leak; the LLM's job is only to TRIAGE
  the script's candidates and drive fixes. Use before publishing, after a
  history rewrite, or whenever you suspect prod data leaked into the tree.
  Trigger keywords: secret scan, leak scan, oss scan, pre-release scan, scrub
  secrets, check for leaked credentials, /oss-secret-scan.
user-invocable: true
---

# OSS secret / PII scan

A two-layer scanner. **Layer 1 is deterministic** (`scan.py`: regex + Shannon
entropy + allowlist) and does 100% of the *detection* — an LLM is never trusted
to "look for secrets" because it drifts and silently misses things. **Layer 2 is
the LLM** (you), which only *triages* the deterministic candidate list and
applies fixes. This split is the whole point: comprehensiveness comes from the
script, judgment comes from the model.

## When to use

- Before an OSS release / first public push of the repo.
- After rewriting git history or importing prod data into seeds/fixtures.
- After any change that copies prod debugging output into committed files.
- As a recurring gate (wire `scan.py --severity medium` into CI).

## How to run

```bash
# 1. Deterministic scan (machine-readable, every category):
python3 .claude/skills/oss-secret-scan/scan.py --json > /tmp/leak-candidates.json

# 2. Human summary, real-leak severities only (CI gate level):
python3 .claude/skills/oss-secret-scan/scan.py --severity medium

# Options:
#   --severity {critical|high|medium|low}  floor (default low = everything)
#   --include-archive                       also scan docs/_archive (default: skip)
#   --allow FILE                            extra allowlist (default .secret-scan-allow)
#   --paths a b ...                         scan only these paths
# Exit code is 1 when any finding at/above the severity floor remains.
```

The script scopes to git-tracked text files, skips binaries / lockfiles /
`node_modules` / `dist`, and tags any hit inside a test fixture
(`testdata/`, `*_test.*`, `/fixtures/`, …) as `likely_intentional` so triage can
sort real leaks to the top.

## Detectors and severity

| Severity | Categories |
|---|---|
| CRITICAL | private keys (PEM), AWS secret keys, GCP `private_key`, DB connection strings with an embedded password (non-localhost) |
| HIGH | AWS access keys, OpenAI/GitHub/Slack/Google/Stripe tokens, JWTs, `password=`/`secret=`/`token=` assignments |
| MEDIUM | public IPv4 (RFC1918 / loopback / TEST-NET excluded), Mac serials, machine IDs / device fingerprints, non-allowlisted emails, EC2 internal hostnames |
| LOW | non-allowlisted domains, generic high-entropy strings (report-only signal) |

## Triage rubric (the LLM's job)

Walk the candidates top-down. For each, decide one of:

- **TRUE-LEAK** — real secret / prod infra / personal data. **Fix it** (see below),
  then re-run. Never commit a known TRUE-LEAK.
- **FALSE-POSITIVE** — a version string that looks like an IP, an RFC section
  number, a code identifier / key-name / token-prefix (not a value), a documented
  dev-only fallback, a well-known public endpoint (`1.1.1.1`), a placeholder
  (`you@company.com`). Add it to `.secret-scan-allow` **with a one-line reason**,
  or add an inline `secret-scan:allow` comment on that line.
- **NEEDS-HUMAN** — genuinely ambiguous (is this demo data or a real customer
  record?). Surface it to the user with the evidence; do not guess.

Spot-check the script's `likely_intentional` tags — a real key parked in a
`_test.go` file is still a leak.

## Fixing leaks — canonical replacements

| Leak | Replace with |
|---|---|
| Prod public IP / SSH host | env var (`${NEXUS_SSH_HOST}`) read from `tests/.env.prod`; never a literal |
| Prod domain | a `nexus.ai` subdomain (cp/api/hub/compliance) for SQL/illustration, or an env-var reference in operational commands |
| Example / placeholder domain | a reserved TLD: `*.example`, `example.com`, `*.test` |
| Private LAN IP | RFC1918 placeholder (`10.0.0.x`); public example IP → TEST-NET `203.0.113.x` |
| Device serial / fingerprint / machineId / token hash | all-zero placeholder of the same shape |
| Personal name / email / handle | a generic maintainer identity (`maintainers@example.com`) |
| Real secret value in committed config | move to env (`os.Getenv` / `bootenv`); document the var in `.env.example` |

Re-run `scan.py` after every batch of fixes until the medium+ floor is clean of
non-`likely_intentional` findings (the remaining fixtures/placeholders should be
covered by `.secret-scan-allow`).

## Allowlist mechanics

`.secret-scan-allow` (repo root) holds confirmed false-positives — one entry per
line, `re:` prefix for a regex, otherwise a literal substring matched against the
flagged value. The built-in allowlist in `scan.py` already covers the project's
own domains (`nexus.ai`, `alphabitcore.com`), reserved example TLDs, well-known
external service hosts (OpenAI / Anthropic / GitHub / the AI surfaces the product
intercepts), and canonical example tokens (AWS docs key). Extend the built-in set
in `scan.py` only for durable, repo-wide safe values; use `.secret-scan-allow`
for everything case-specific.

## References

- `.claude/skills/oss-secret-scan/scan.py` — the deterministic detector
- `.secret-scan-allow` — repo-root allowlist of confirmed false-positives
- `tests/.env.prod.example` — where prod values belong (env, gitignored real copy)
- `.env.example` — env-var catalog (secrets are env-only per CLAUDE.md)
