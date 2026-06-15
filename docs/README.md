# Nexus Gateway docs

Documentation hub. The text below tells you which subtree to open by what you're trying to do.

## I want to…

| Goal | Open |
|---|---|
| See the product without deploying it | [`users/product/tour.md`](./users/product/tour.md) — screenshot tour |
| Use the gateway as an admin / integrator / end-user | [`users/`](./users/) |
| Understand how a subsystem works before editing code | [`developers/architecture/`](./developers/architecture/) — per-area architecture docs (the trigger map indexes every doc by editing area) |
| Build a feature (SDD pipeline, conventions, handoff) | [`developers/workflow/`](./developers/workflow/) |
| Read formal specs (requirements + SDD per epic) | [`developers/specs/`](./developers/specs/) |
| Run the gateway in production | [`operators/`](./operators/) |

## Layout

```
docs/
├── README.md             ← you are here
├── users/                ← admin / integrator / end-user surface
│   ├── README.md
│   ├── product/          ← overview, features, deployment models
│   └── features/         ← per-UI-section docs (cp-ui, agent-ui) and cross-service flows
├── developers/           ← contributor surface
│   ├── README.md
│   ├── architecture/     ← system architecture
│   │   ├── services/        ← per-service: agent, ai-gateway, compliance-proxy, control-plane, hub
│   │   └── cross-cutting/   ← foundation, observability, safety, shared, storage, ui
│   ├── workflow/         ← SDD pipeline, conventions, local-dev debugging, testing
│   └── specs/            ← per-epic requirements + SDD bundles
└── operators/            ← SRE / production surface
    └── ops/
        └── runbooks/
```

## Binding rules and contribution workflow

Both live at the repo root, not under `docs/`:

- [`CLAUDE.md`](../CLAUDE.md) — binding charter (mandatory rules, pre-edit reading, development workflow)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — how to send a change
- [`README.md`](../README.md) — repo overview and quick start

## Conventions

- **English-only.** Everything under `docs/**` is English. See `CLAUDE.md` → mandatory rules.
- **Code-anchored.** Every claim in a doc must be verifiable against current code. Audit before edit, fix the doc when code changes.
- **Forward-looking.** Docs describe how things work today, not how they evolved.
