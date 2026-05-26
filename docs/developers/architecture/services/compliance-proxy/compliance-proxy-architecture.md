# Compliance Proxy architecture

The Compliance Proxy is an explicit forward proxy that intercepts outbound
HTTPS to AI provider and AI consumer surfaces, applies the compliance pipeline
to the decrypted traffic, and emits an audit record. This doc is the service
front door — the request lifecycle at a glance and an index into the per-concern
docs.

## Request lifecycle

```
client CONNECT
  → access gate (source-IP / domain allowlist, private-IP check)
  → tunnel established (200 Connection Established)
  → forward gate: kill-switch? pinning-exempt? hook-exempt? → bump or passthrough
  → TLS bump (leaf cert from the per-target issuer/cache)
  → normalize the request → compliance hooks → rewrite if modified → forward upstream
  → normalize the response → response hooks → return to client
  → emit audit event
```

## Sub-doc index

| Concern | Doc |
|---|---|
| CONNECT entry, access control, connection lifecycle, forward gate | [compliance-proxy-connect-forward-architecture.md](compliance-proxy-connect-forward-architecture.md) |
| TLS interception: leaf cert issuance, cache, KMS envelope, pinning | [compliance-proxy-tls-cert-architecture.md](compliance-proxy-tls-cert-architecture.md) |
| Normalize stage + adding a Tier-1 traffic adapter / Tier-2 detector | [compliance-pipeline-architecture.md](compliance-pipeline-architecture.md) |
| Runtime admin API, token auth, break-glass, kill-switch state, exemptions, config | [compliance-proxy-runtime-api-architecture.md](compliance-proxy-runtime-api-architecture.md) |
| Domain matching + device predicate | [domain-device-predicate-architecture.md](domain-device-predicate-architecture.md) |

Cross-cutting concerns the proxy participates in are owned elsewhere: the shared
TLS bump (`packages/shared/transport/tlsbump`, also driven by the Agent) in
[agent-forwarder-architecture.md](../agent/agent-forwarder-architecture.md); the
audit MQ pipeline in
[audit-pipeline-architecture.md](../../cross-cutting/observability/audit-pipeline-architecture.md);
SIEM forwarding in
[siem-bridge-architecture.md](../../cross-cutting/observability/siem-bridge-architecture.md);
kill-switch propagation in
[kill-switch-architecture.md](../../cross-cutting/safety/kill-switch-architecture.md).

## Audit emission

`audit.MQBatchWriter` (`packages/compliance-proxy/internal/audit`) batches audit
events to the MQ producer, falls back to an NDJSON disk spool when MQ is
unavailable, and tees to the SIEM bridge. `WithThingIdentity` stamps the proxy's
`thing_id` / `thing_name` onto every event; `WithNormalizer` attaches the
normalize function that populates the `*_normalized` sidecar. The proxy never
writes `traffic_event` directly — the Hub db-writer is the sole writer of that
table; the proxy only produces events. The MQ pipeline and Hub-side consumer are
in [audit-pipeline-architecture.md](../../cross-cutting/observability/audit-pipeline-architecture.md).

## References

- `packages/compliance-proxy/cmd/compliance-proxy/` — service entry point and wiring
- `packages/compliance-proxy/internal/proxy/` — CONNECT, access, forward path
- `packages/compliance-proxy/internal/tls/` — certificate issuance and caching
- `packages/compliance-proxy/internal/runtime/` — runtime admin API
- `packages/compliance-proxy/internal/audit/` — MQ batch writer + NDJSON fallback
- `packages/shared/transport/tlsbump/` — shared MITM bump
