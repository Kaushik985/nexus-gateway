#!/usr/bin/env bash
# multi-service.sh — run the SAME workload against several OpenAI-compatible
# gateways in the SAME wall-clock window (simultaneously). Because all gateways
# then sample identical upstream (provider) conditions concurrently, the shared
# upstream latency cancels out when you take the per-round delta between
# gateways — so the TTFT delta is ~pure gateway overhead, not upstream variance.
# Running gateways one after another instead lets each hit a different upstream
# window, which manufactures false differences. See README "Why test multiple
# services simultaneously".
#
# Usage:
#   NEXUS_VK=nvk_... ./multi-service.sh [profile] [conc:dur] [rounds]
#   NEXUS_VK=nvk_... ./multi-service.sh profiles/realistic.json 50:60s 3
#
# Define the gateways under test in the SERVICES array below:
#   name | target URL | model string | bearer token   (bearer "" = no auth)
# Secrets come from env vars — never hardcode a key here.
set -u
cd "$(dirname "$0")"

PROFILE="${1:-profiles/realistic.json}"
STAGES="${2:-50:60s}"
ROUNDS="${3:-3}"
LT="${LOADTEST_BIN:-./loadtest}"

# Edit this list for your gateways. Each runs the same PROFILE; only the
# target/model/auth differ. Competitors are commented out as examples —
# uncomment and supply their endpoint/model/key to compare.
SERVICES=(
  "nexus|http://localhost:3050/v1/chat/completions|gpt-4o-mini|${NEXUS_VK:-REPLACE_WITH_VK}"
  # "litellm|http://localhost:4000/v1/chat/completions|gpt-4o-mini|${LITELLM_KEY:-}"
  # "bifrost|http://localhost:8080/v1/chat/completions|openai/gpt-4o-mini|"
)

# Build the generator if it isn't present.
if [ ! -x "$LT" ]; then
  echo "building loadtest binary..."
  GOWORK=off go build -o ./loadtest . || { echo "build failed"; exit 1; }
  LT=./loadtest
fi

echo "profile=$PROFILE stages=$STAGES rounds=$ROUNDS services=${#SERVICES[@]}"
echo

for r in $(seq 1 "$ROUNDS"); do
  echo "################  ROUND $r/$ROUNDS  (all services launched simultaneously)  ################"
  pids=()
  for svc in "${SERVICES[@]}"; do
    IFS='|' read -r name target model bearer <<<"$svc"
    out="runs/$name"; mkdir -p "$out"
    vkflag=(); [ -n "$bearer" ] && vkflag=(-vk "$bearer")
    "$LT" -config "$PROFILE" -stages "$STAGES" -target "$target" -model "$model" \
      -out "$out" ${vkflag[@]+"${vkflag[@]}"} >"$out/console-r$r.log" 2>&1 &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p"; done

  python3 - "${SERVICES[@]}" <<'PY'
import sys, json, glob, os
names = [s.split('|', 1)[0] for s in sys.argv[1:]]
rows = []
for name in names:
    files = sorted(glob.glob(f"runs/{name}/summary-*.json"), key=os.path.getmtime)
    if not files:
        rows.append((name, "NO-DATA", "", "", "", "")); continue
    st = json.load(open(files[-1]))["stages"][-1]["total"]
    rows.append((name,
        f'{st["ttft_ms"]["P50"]:.0f}', f'{st["ttft_ms"]["P95"]:.0f}',
        f'{st["latency_ms"]["P95"]:.0f}', f'{st["throughput_rps"]:.1f}',
        f'{100*st["error_rate"]:.2f}%'))
hdr = ("gateway", "ttft_p50", "ttft_p95", "lat_p95", "rps", "err")
w = [max(len(str(x)) for x in col) for col in zip(hdr, *rows)]
line = lambda c: "  ".join(str(v).ljust(w[i]) for i, v in enumerate(c))
print(line(hdr)); print(line(["-"*x for x in w]))
for row in rows: print(line(row))
vals = [(r[0], float(r[1])) for r in rows if r[1] != "NO-DATA"]
if len(vals) > 1:
    base = min(v for _, v in vals)
    print("\nttft_p50 delta vs fastest (= gateway overhead; upstream is shared this window):")
    for n, v in sorted(vals, key=lambda x: x[1]):
        print(f"  {n:10} +{v-base:6.0f} ms")
PY
  echo
done
echo "raw reports/summaries under: $(pwd)/runs/<gateway>/"
