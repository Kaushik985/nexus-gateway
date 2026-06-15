# Developer documentation

Documentation for contributors to Nexus Gateway.

## I want to…

| Goal | Open |
|---|---|
| Understand how a subsystem works before editing code | [`architecture/README.md`](./architecture/README.md) — the trigger map: "what to read when editing X" |
| Get the system overview (topology, data flows, deployment) | [`architecture/overview.md`](./architecture/overview.md) |
| Follow the build / test / SDD workflow | [`workflow/`](./workflow/) |
| Read the code conventions | [`workflow/conventions.md`](./workflow/conventions.md) |
| Set up the local dev stack | [`workflow/local-dev-debugging.md`](./workflow/local-dev-debugging.md) |

## Layout

```
docs/developers/
├── README.md             ← you are here
├── architecture/         ← system architecture docs
│   ├── README.md            ← trigger map: editing area → which doc to read
│   ├── overview.md          ← system topology, data flows, service boundaries
│   ├── services/            ← per-service: agent, ai-gateway, compliance-proxy,
│   │                           control-plane, nexus-hub
│   └── cross-cutting/       ← foundation, observability, safety, shared, storage, ui
├── workflow/             ← contributor workflow
│   ├── conventions.md       ← naming, errors, concurrency, logging, metrics, commit style
│   ├── local-dev-debugging.md ← service ports, log paths, env files, admin API helpers
│   ├── testing.md           ← Go test policy, coverage gate, Vitest
│   └── …                   ← additional workflow docs
└── specs/               ← per-epic requirements + SDD bundles
```

## Binding rules

The rules that govern every change live at the repo root:

- [`CLAUDE.md`](../../CLAUDE.md) — binding charter (plan, todo, English-only, IAM review, coverage gate, …)
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — how to send a change, local dev quickstart, pre-commit checks

The three-doc pre-edit reading rule (architecture doc + feature doc + conventions) is in `CLAUDE.md` → "Pre-edit reading".
