# Runbook — Compliance pipeline build failures (refused traffic after a hook edit)

## Symptom

Immediately after a hook/rule-pack change in the Control Plane UI, traffic through the data plane starts failing:

- **Compliance Proxy**: CONNECTs answered `403` with body `compliance pipeline unavailable`; bumped requests/responses answered `502` (at reject level 2 the body carries reason code `PIPELINE_BUILD_FAILED`; at the default level 1 the client sees the generic policy-block body — rely on the 502 status + logs/audit rows, not the body text); SSE streams close right after headers.
- **AI Gateway**: `/v1/*` requests answered `500` (streaming requests whose response-stage hook fails to build refuse in-band instead: the stream terminates after the 200 headers).
- Traffic page shows audit rows with bump status **`BUMP_PIPELINE_BUILD_FAILED`** and decision `REJECT_HARD` for the request/response/SSE stages. A connection-stage (CONNECT) refusal leaves NO audit row — no transaction exists yet at CONNECT time — so its only signals are the 403, the metric, and the log line.
- Prometheus: `nexus_tunnels_total{result="rejected_build_failed"}` climbing on the proxy.
- Service logs carry `pipeline build failed` / `failed to build ... pipeline under strict fail-closed` warnings naming the hook.

## Why this happens

A hook marked **fail-closed** could not be *built* — not a runtime error, a construction failure. Typical causes: an `implementationId` that doesn't exist in the hook registry (typo, or a script/webhook implementation that was removed), a config payload the implementation rejects, or a connection-stage hook bound to an implementation that isn't connection-compatible.

A fail-open hook in the same state is simply skipped (logged once). A fail-closed hook is the admin's "this scanner is mandatory" declaration, so the AI Gateway and the Compliance Proxy refuse the traffic rather than forward it uninspected. The agent's on-device proxy is the deliberate exception — it sits in the host's outbound packet path, so it always skips-and-logs and never refuses (a hook typo must not take down a laptop's networking).

## Diagnosis (2 minutes)

1. Find the hook: the refusing service's log line names it —
   `journalctl -u nexus-compliance-proxy --since -15m | grep -iE "pipeline build failed|failed to build"`
   (or `nexus-ai-gateway`). The message carries the hook id + the build error.
2. Confirm scope: every refused flow shares the same `BUMP_PIPELINE_BUILD_FAILED` audit rows / `rejected_build_failed` counter — this is config-wide, not per-client.

## Fix

In Control Plane UI → Compliance → Hooks & Policies, open the named hook and either:

- correct its `implementationId` / configuration (the JSON-schema panel re-validates), or
- disable the hook (status switch) until the config is fixed, or
- if the mandatory-control semantics were unintended, change `failBehavior` to fail-open (it then degrades to skip-with-warning instead of refusing).

The config push takes effect on the next request — no service restart. Verify: the warning stops, `rejected_build_failed` flattens, and a test request passes (`Hooks & Policies → Test` tab, or the proxy smoke runbook).
