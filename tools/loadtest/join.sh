#!/usr/bin/env bash
# join.sh — OPTIONAL, Nexus-specific post-processing.
#
# Correlates the load tester's client-side results (results-*.jsonl) with the
# gateway's server-side traffic_event rows by the per-conversation UUID, so you
# can put client-observed latency next to server-measured latency, upstream
# time, tokens, and cache_status.
#
# The load tester itself has NO database dependency; this helper is the bridge
# for when you DO have psql access to the gateway's Postgres.
#
# Usage:
#   PGHOST=... PGUSER=nexus PGDATABASE=nexus_gateway PGPASSWORD=... \
#     ./join.sh runs/results-<ts>.jsonl
#
# The UUID is sent both in the prompt (front of the first message) and as the
# x-request-id header. By default we match on traffic_event.external_request_id;
# if your gateway records the header elsewhere, set JOIN_COL (e.g. trace_id) or
# use the text-search fallback printed at the end.
set -euo pipefail

JSONL="${1:?usage: join.sh <results.jsonl>}"
JOIN_COL="${JOIN_COL:-external_request_id}"

# Extract distinct conversation UUIDs from the client results.
uuids=$(grep -oE '"conv_uuid":"[0-9a-f]+"' "$JSONL" | sed -E 's/.*:"([0-9a-f]+)"/\1/' | sort -u)
n=$(printf '%s\n' "$uuids" | grep -c . || true)
echo "client conversations: $n"
[ "$n" -gt 0 ] || { echo "no conv_uuid found in $JSONL"; exit 1; }

# Build a quoted IN-list.
inlist=$(printf "'%s'," $uuids); inlist="${inlist%,}"

sql=$(cat <<SQL
SELECT te.${JOIN_COL}                               AS conv_uuid,
       te.status_code,
       te.latency_ms                                AS server_latency_ms,
       te.upstream_total_ms,
       te.upstream_ttfb_ms                          AS server_ttfb_ms,
       te.prompt_tokens, te.completion_tokens,
       te.cache_status,
       te.estimated_cost_usd
FROM traffic_event te
WHERE te.${JOIN_COL} IN (${inlist})
ORDER BY te.timestamp;
SQL
)

echo "== server-side rows joined by ${JOIN_COL} =="
matched=$(psql -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM traffic_event WHERE ${JOIN_COL} IN (${inlist});")
echo "matched server rows: ${matched} / ${n} client conversations"
psql -v ON_ERROR_STOP=1 -c "$sql"

if [ "${matched:-0}" = "0" ]; then
  cat <<'HINT'

No rows matched on the chosen column. Your gateway may not surface x-request-id there.
The UUID is ALSO embedded at the front of the prompt, so a text-search fallback works
(slower; matches the normalized request text):

  SELECT te.id, te.latency_ms, te.upstream_total_ms, te.prompt_tokens, te.cache_status
  FROM traffic_event te
  JOIN traffic_event_normalized n ON n.traffic_event_id = te.id
  WHERE n.request::text LIKE '%<one-uuid>%';

Or set JOIN_COL=trace_id and re-run.
HINT
fi
