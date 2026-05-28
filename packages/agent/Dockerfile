# Linux Nexus Agent image for CI daemon-bound e2e tests.
#
# The agent is pure-Go (CGO_ENABLED=0) and depends only on the sibling
# packages/shared module (its single go.mod replace). Build context is the repo
# root so both modules are visible:  docker build -f packages/agent/Dockerfile .
#
# The runtime image carries iptables/nftables because the Linux agent intercepts
# via netfilter redirect (see agent-linux-platform-architecture.md); `run`
# therefore needs NET_ADMIN. `enroll` only needs HTTP to the Hub.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/
WORKDIR /src/packages/agent
# GOWORK=off so the build uses this module's `replace => ../shared`, not the
# repo go.work (which references modules we did not copy).
RUN GOWORK=off CGO_ENABLED=0 go build -trimpath -o /out/nexus-agent ./cmd/agent

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends iptables ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/nexus-agent /usr/local/bin/nexus-agent
COPY packages/agent/agent.dev.yaml /etc/nexus-agent/agent.yaml
# Config + cert live under /etc/nexus-agent (mountable / overridable in CI).
ENV NEXUS_AGENT_CONFIG=/etc/nexus-agent/agent.yaml
WORKDIR /etc/nexus-agent
ENTRYPOINT ["/usr/local/bin/nexus-agent"]
CMD ["version"]
