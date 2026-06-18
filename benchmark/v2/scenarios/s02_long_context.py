"""S-02: Long Context — Cache Disabled."""
from __future__ import annotations
import asyncio
import os
from engine.metrics import ScenarioMetrics
from engine.runner import run_scenario
from engine.models import GatewayFullConfig
from gateway_adapters.base import BaseGatewayAdapter
from scenarios.base_scenario import load_prompts

SCENARIO_ID = "S-02"
THRESHOLDS = {"ttft_p95_ms": 3000, "http_failure_pct": 2.0}

async def run(config: GatewayFullConfig, adapter: BaseGatewayAdapter, mode: str = "cache-disabled") -> ScenarioMetrics:
    prompts = load_prompts("long_context_v2.json")
    metrics = ScenarioMetrics(gateway_name=config.gateway.name, scenario_id=SCENARIO_ID, mode=mode)
    # S-02 historically halves VUs because each 16k-token request is far heavier
    # upstream than short chat (one 16k request ≈ many short ones on TPM). This
    # USED to be silent — BENCH_VUS=3 quietly ran at 1 VU. Now it's logged, and
    # BENCH_S02_NO_HALVE=1 disables the halving for operators who want the exact
    # BENCH_VUS they set. To get 3 effective VUs with halving on, set BENCH_VUS=6.
    configured = config.benchmark.virtual_users
    if os.getenv("BENCH_S02_NO_HALVE", "").lower() in ("1", "true", "yes"):
        vus = max(1, configured)
        print(f"  [S-02] BENCH_S02_NO_HALVE set — running {vus} VU(s) (no halving)")
    else:
        vus = max(1, configured // 2)
        print(f"  [S-02] long-context VU halving: configured={configured} → effective={vus} VU(s) "
              f"(set BENCH_S02_NO_HALVE=1 to disable, or BENCH_VUS={configured*2 if configured else 6} for {configured or 3} effective)")
    await run_scenario(
        config=config, adapter=adapter, prompts=prompts,
        virtual_users=vus,
        duration_seconds=config.benchmark.test_duration_seconds,
        metrics=metrics,
        warmup_seconds=60,
    )
    return metrics
