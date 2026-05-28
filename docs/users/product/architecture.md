# Architecture

Nexus Gateway is an enterprise AI-traffic gateway. At a high level it is five cooperating components that put governance — compliance, routing, caching, and auditing — in the path of your organization's AI traffic, managed from a single admin console.

## The components

- **AI Gateway** — the server-side API entry point. Applications send their AI requests to the gateway with a virtual key instead of straight to the provider; the gateway routes the request, can serve it from cache, runs it through the compliance pipeline, and forwards it to the provider.
- **Compliance Proxy** — a network proxy that intercepts outbound HTTPS to AI provider and consumer surfaces, inspects the decrypted traffic against the compliance pipeline, and records it. This is how traffic from browsers and desktop AI tools — which never call the gateway directly — is brought under governance.
- **Agent** — a lightweight program that runs on a user's device and intercepts that device's AI traffic at the source, applying the same compliance pipeline locally.
- **Control Plane** — the admin console (the web UI you log into) and its API. This is where administrators configure providers, routing, virtual keys, compliance rules, quotas, identity, and everything else, and where they watch traffic and fleet health.
- **Nexus Hub** — the coordination core that every other component connects to. Configuration set in the console flows through the Hub out to each component, and each component reports its health back through it.

## Three ways AI traffic is governed

AI traffic comes under governance through three entry paths, and all three run the **same compliance pipeline and produce the same audit records**:

- through the **AI Gateway**, for applications that integrate with it directly using a virtual key;
- through the **Compliance Proxy**, for traffic captured at the network layer (including browser and consumer AI surfaces);
- through the **Agent**, for traffic intercepted on the endpoint device itself.

An organization can use any combination of the three depending on where its AI traffic originates.

## How configuration reaches every component

Administrators make changes in the Control Plane console. The Control Plane writes them through the Hub, and each component — every gateway, proxy, and agent — pulls its configuration and applies it. The console's Infrastructure section shows every component as a node, with its health and whether its applied configuration is in sync with the target the platform set for it. See the [Infrastructure feature docs](../features/cp-ui/infrastructure-nodes.md) for the operator view.

## What the paths share

Regardless of entry path, the platform shares one set of building blocks: the **compliance pipeline** (hooks and rule packs that inspect, transform, or block content), the **traffic and audit records** that every inspected request produces, **virtual keys** that authorize and attribute usage, and the **identity and access model** (organizations, projects, users, roles, and policies) that governs who can do what.

## Under the hood

The backend services are written in Go and share a PostgreSQL database for persistent state, a Valkey cache (Redis-wire-compatible) for caching, and a message queue for asynchronous work. The admin console is a React application served by the Control Plane. Agents run on user devices and connect back to the Hub. For the developer-facing view of the same system, see the [architecture overview](../../developers/architecture/overview.md).

## References

- `packages/ai-gateway/` — the AI Gateway service
- `packages/compliance-proxy/` — the Compliance Proxy service
- `packages/agent/` — the endpoint Agent
- `packages/control-plane/` and `packages/control-plane-ui/` — the admin API and console
- `packages/nexus-hub/` — the coordination Hub
- `docs/developers/architecture/overview.md` — the developer architecture front door
- `docs/users/features/cp-ui/` and `docs/users/features/agent-ui/` — the per-surface feature docs
