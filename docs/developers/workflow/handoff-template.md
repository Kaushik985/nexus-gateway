# Handoff template

A handoff is a deliberate, on-disk document that lets the next session pick up a
program without re-deriving its state. It exists because auto-compact summarizes
a long session but loses fidelity — a handoff file the next session reads back is
the reliable carrier of load-bearing facts.

## When to write one

A handoff is *offered proactively* when a session is heavy with accumulated
state, and written once the user agrees. The triggers:

- The auto-compact threshold is near.
- A multi-phase program is closing out.
- The session has run more than roughly fifty tool-call turns.
- A major push has just landed.

The anti-pattern is offering a handoff after a single task completes — finishing
one task is not a trigger. A handoff is for carrying a *program* across the
session boundary, not for narrating routine work.

## Where it lives

Handoffs live under `docs/handoffs/`:

- A multi-document program uses a directory: `docs/handoffs/<program-area>/HANDOFF.md`,
  with any plan or tracking files (`PLAN.md`, `TRACKING.md`) alongside it.
- A single-file program uses `docs/handoffs/<program>.md`.

## What it must contain

Every handoff captures four things:

1. **Program goal and current phase** — the one-line goal, and where the work
   currently stands.
2. **Load-bearing facts** — the architecture, API, and data facts the next
   session needs to avoid re-discovering them: the invariants that must not
   break, the wiring that is non-obvious, the contracts other code depends on.
3. **Work completed this session** — what landed, with enough specificity that
   the next session can trust it without re-verifying.
4. **Next steps to pre-load** — the remaining work in order, plus the memory
   anchors and binding rules the next session should load before starting.

These map onto the spine the existing handoffs under `docs/handoffs/` already
use: a goal, a status block, per-phase sections (context, plan, file touch list,
verification), a set of binding reminders, what landed, and the next steps.

## The skeleton

```markdown
# <Program> — handoff

## Goal
<one-line program goal>

## Status
<current phase; what is in flight vs done vs queued>

## Load-bearing facts
- <invariant / contract / wiring fact the next session must not break>
- <non-obvious architecture or data-flow detail>

## Work completed this session
- <what landed, specific enough to trust>

## Next steps (in order)
1. <next task>
2. <task after that>

## Binding rules to pre-load
- <rules from CLAUDE.md / .cursor/rules that govern this work>

## Memory anchors
- [[<project-type memory entry for this program>]]
```

## Pairing with memory and a fresh session

A handoff is paired with a project-type entry in maintainer memory so the program
is discoverable later, not only from the on-disk file. After writing the handoff,
suggest starting a fresh session: the next session reads the handoff back at full
fidelity rather than relying on a compacted summary of the current one.

## References

- `CLAUDE.md` — the "Handoff at context-full" rule (triggers, required content, location)
- `docs/handoffs/` — where handoff and plan/tracking files live
