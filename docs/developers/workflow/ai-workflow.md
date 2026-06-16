# AI workflow

Development on this repository is AI-assisted, and it runs through a mandatory
pipeline plus a set of always-on disciplines. The agent treats `CLAUDE.md` and
the rules under `.cursor/rules/` as binding context loaded into every session;
this page is the narrative walkthrough of that workflow, while `CLAUDE.md` is the
terse, canonical rule-set it mirrors.

## The mandatory pipeline

Every change — down to a one-liner — moves through the same stages:

```
Plan + Todo → Architecture → Requirements → Story spec → OpenAPI → Code → Unit tests → Verify → Ask about commit
```

- **Plan + Todo.** Produce a written plan before any edit, and capture the work
  as a live todo list. Use the `/brainstorm` superpower on a non-trivial problem.
  The plan is confirmed with the user unless already approved in-thread.
- **Architecture.** Read `docs/developers/architecture/overview.md` first; update
  it if components, boundaries, data flow, deployment, or external integrations
  change, otherwise record an explicit "no architecture impact" note.
- **Requirements.** Capture functional and non-functional requirements, roles,
  constraints, a glossary, and MoSCoW priority in the epic requirements document
  (stored in the internal `docs/developers/specs/` tree).
- **Story spec.** Break requirements down into epics, stories, and tasks — each
  story carrying a user-story statement, its tasks, and acceptance criteria
  (spec-driven development).
- **OpenAPI.** For every story with an API endpoint, write the OpenAPI 3.1 spec
  — paths, request/response schemas, error responses, and examples — so the
  Control Plane UI calls match the contract.
- **Code.** Go route handlers conform to the OpenAPI; Prisma models align with the
  spec; no placeholder production code.
- **Unit tests.** `go test -race -count=1` (table-driven where it fits) and Vitest
  for the UI, deterministic and aligned to the acceptance criteria, under the
  ≥95% coverage gate.
- **Verify.** The mandatory gate — the workspace tests are green and the
  completion checklist is satisfied.
- **Ask about commit.** The agent proposes a commit message and waits; it never
  commits unsolicited.

## The always-on disciplines

These hold across every stage, each surfaced in `CLAUDE.md` and mirrored by a
rule under `.cursor/rules/`:

- **Plan first.** No jumping straight to code (`sdd-workflow.mdc`).
- **A live todo list captures every request.** Each user request becomes a todo
  immediately; a new request mid-session does not interrupt in-flight work — it
  is captured and queued, and the current task runs to a natural commit point
  first.
- **Plan + Todo are non-waivable for complex tasks** — more than two files,
  cross-cutting work, an API or data-model change, or a high-blast-radius surface
  (`complex-task-plan-todo.mdc`).
- **Goal-anchored execution.** The user's request is written as a one-line
  "Goal:" at the top of the plan and restated when mid-stream constraints arrive.
- **A two-round self-audit before "done"** — four questions, twice, until two
  consecutive rounds are clean (`completion-time-self-audit.mdc`).
- **Adversarial product review and less-is-more.** Steel-man a proposed feature
  then attack it; prefer a sensible default over a new config knob, and delete
  instead of add when in doubt (`adversarial-product-review.mdc`).
- **Real implementation only.** No `TODO` / `FIXME` / stub / fake-return in
  production code; test doubles belong in test code.
- **Release policy (1.0 GA): backward compatibility for shipped contracts.**
  Shipped contracts (public/admin API, agent↔Hub protocol, released `shared/`
  API, DB schema, config keys, `traffic_event` shape) stay backward compatible
  or ship a migration + deprecation window; internal-only code stays greenfield
  — delete dead code outright, no parallel legacy paths (`release-compat-policy.mdc`).
- **One worktree per session.** Each parallel session runs in its own
  `git worktree` so the working tree and index are private to it
  (`worktree-per-session.mdc`).
- **Sub-agent dispatch discipline.** Delegate mechanical multi-file work,
  parallel-safe research, or bounded-scope tasks — never the understanding of a
  new problem, a scope or contract decision, or anything that commits
  (`sub-agent-dispatch.mdc`).

## Pre-edit reading

Before editing code, read all three of: the architecture doc(s) for the edit
area (found via the trigger map in `docs/developers/architecture/README.md`), the
feature doc(s) for any user-visible surface, and `conventions.md` for style. The
`pre-edit-reader` skill walks a contributor through this requirement.

## How the tooling fits together

- **`.cursor/rules/*.mdc`** are the always-on bindings, loaded into every editor
  session; `CLAUDE.md` is the canonical rule-set they mirror.
- **Skills** (`.claude/skills/`) are the on-demand `/skill-name` procedures that
  slot into this workflow — cataloged in [ai-skill-catalog.md](ai-skill-catalog.md).
- **Maintainer memory** carries cross-session context (ongoing work, conventions,
  and corrections) so a fresh session starts informed.

## References

- `CLAUDE.md` — the canonical mandatory rules and development workflow
- `.cursor/rules/` — the always-on IDE bindings mirrored from `CLAUDE.md`
- `docs/developers/architecture/overview.md` — the architecture entry point
- [ai-skill-catalog.md](ai-skill-catalog.md) — the on-demand skills
- [testing.md](testing.md) — the test workflow the pipeline's test stages use
- [conventions.md](conventions.md) — the code-level style the pipeline follows
