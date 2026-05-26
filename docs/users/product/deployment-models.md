# Deployment models

Nexus Gateway is the same platform — the AI Gateway, Compliance Proxy, Agent, Control Plane and its console, and the Nexus Hub, backed by a database, a cache, and a message queue — run in one of three ways depending on how much you want to operate yourself and how isolated your environment must be: **SaaS**, **self-hosted**, or **air-gapped**. The components and the way they govern AI traffic are identical across all three; only who runs the infrastructure and how it connects to the outside world changes.

## SaaS (hosted)

In the hosted model, the platform's management plane is operated for you: you do not stand up the database, services, or console yourself. You connect your applications, proxies, and agents to the hosted endpoint and administer everything through the same console. This is the lowest-operational-burden option — there is no infrastructure for your team to run or upgrade.

## Self-hosted

In the self-hosted model, you run the whole stack on your own infrastructure. The backing stores — PostgreSQL, the cache, and the message queue — come up via the project's container compose definition, and the five services and the console run on top of them. A single node is enough for a trial or a small deployment, and the same components scale out for larger fleets. You own the data, the network boundary, and the upgrade cadence. The operator documentation covers the bring-up, single-node and scaled topologies, certificates, backup and recovery, and monitoring.

## Air-gapped

For isolated or offline networks with no outbound internet, the same self-hosted stack runs with no external dependencies. Updates, provider credentials, and rule packs are brought in out of band rather than fetched over the network. The air-gapped deployment runbook in the operator documentation is the authoritative procedure for this model.

## Choosing a model

The three differ only in operations and isolation, not in what the product does:

- **SaaS** — least to operate; suitable when running infrastructure yourself is not a requirement.
- **Self-hosted** — full control over data residency, network boundary, and upgrade timing; suitable for most enterprise on-premises and private-cloud deployments.
- **Air-gapped** — strict isolation for regulated or disconnected environments, at the cost of out-of-band update handling.

## References

- `docker-compose.yml` and `scripts/dev-start.sh` — the self-hosted bring-up of the backing stores and services
- `packages/nexus-hub/`, `packages/control-plane/`, `packages/ai-gateway/`, `packages/compliance-proxy/`, `packages/agent/` — the five services that make up the stack
- `docs/operators/ops/deployment.md` and `docs/operators/ops/ec2-single-node.md` — operator deployment and single-node topology
- `docs/operators/ops/runbooks/air-gapped-deployment.md` — the air-gapped procedure
- `docs/operators/ops/backup-dr.md`, `docs/operators/ops/pki-and-certs.md`, `docs/operators/ops/monitoring.md` — backup/recovery, certificates, and monitoring
- `docs/users/product/architecture.md` — the components referenced here
