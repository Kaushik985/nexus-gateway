import { describe, it, expect } from 'vitest';
import {
  catalogFor,
  isThingStatsType,
  formatStatsValue,
  THING_STATS_CATALOG,
} from '../../../../../../src/pages/infrastructure/_shared/tabs/metrics/thingStatsMetricCatalog';

describe('catalogFor / isThingStatsType', () => {
  it('returns an entry for each data-plane Thing type', () => {
    for (const t of ['agent', 'ai-gateway', 'compliance-proxy']) {
      expect(catalogFor(t)).not.toBeNull();
      expect(isThingStatsType(t)).toBe(true);
    }
  });
  it('returns null / false for non-data-plane types', () => {
    expect(catalogFor('control-plane')).toBeNull();
    expect(catalogFor('nexus-hub')).toBeNull();
    expect(isThingStatsType('nexus-hub')).toBe(false);
  });
});

describe('catalog shape per Thing type', () => {
  it('agent carries byte + process KPIs, no token KPIs', () => {
    const ids = THING_STATS_CATALOG.agent.kpis.map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(['bytesIn', 'bytesOut', 'distinctProcesses', 'actionsDenied']));
    expect(ids).not.toContain('promptTokens');
  });
  it('ai-gateway carries token KPIs + model/provider breakdowns', () => {
    const ids = THING_STATS_CATALOG['ai-gateway'].kpis.map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(['promptTokens', 'completionTokens', 'totalTokens']));
    const bids = THING_STATS_CATALOG['ai-gateway'].breakdowns.map((b) => b.id);
    expect(bids).toEqual(expect.arrayContaining(['topModels', 'topProviders']));
  });
  it('compliance-proxy carries bump + hook KPIs', () => {
    const ids = THING_STATS_CATALOG['compliance-proxy'].kpis.map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(['bumpSuccess', 'bumpFailed', 'bumpExempt', 'hookDeny']));
  });
});

describe('KPI derive functions', () => {
  const kpi = (type: 'agent' | 'ai-gateway' | 'compliance-proxy', id: string) =>
    THING_STATS_CATALOG[type].kpis.find((k) => k.id === id)!;

  it('successRate: ok/total*100, null when no traffic', () => {
    const d = kpi('agent', 'successRate').derive!;
    expect(d({ status_2xx_count: 90, status_4xx_count: 5, status_5xx_count: 5 })).toBe(90);
    expect(d({})).toBeNull();
  });
  it('avgLatency: sum/count, null when count 0', () => {
    const d = kpi('agent', 'avgLatency').derive!;
    expect(d({ latency_sum: 1000, latency_count: 4 })).toBe(250);
    expect(d({ latency_sum: 1000, latency_count: 0 })).toBeNull();
  });
  it('phase averages derive from {phase}_sum / {phase}_count', () => {
    const d = kpi('agent', 'avgUpstreamTtfb').derive!;
    expect(d({ latency_upstream_ttfb_sum: 600, latency_upstream_ttfb_count: 3 })).toBe(200);
    expect(d({})).toBeNull();
  });
});

describe('trend derive functions (phase avg)', () => {
  it('computes avg per bucket, null on empty bucket', () => {
    const trend = THING_STATS_CATALOG.agent.trends.find((t) => t.id === 'latencyUsTrend')!;
    expect(trend.derive!({ latency_us_sum: 300, latency_us_count: 2 })).toBe(150);
    expect(trend.derive!({ latency_us_count: 0 })).toBeNull();
  });
});

describe('formatStatsValue', () => {
  it('renders null / NaN as an em dash', () => {
    expect(formatStatsValue(null, 'count')).toBe('—');
    expect(formatStatsValue(NaN, 'ms')).toBe('—');
  });
  it('percent → one decimal', () => {
    expect(formatStatsValue(98.76, 'percent')).toBe('98.8%');
  });
  it('ms → ms under 1s, seconds at/above 1s', () => {
    expect(formatStatsValue(4.2, 'ms')).toBe('4.20 ms');
    expect(formatStatsValue(120, 'ms')).toBe('120 ms');
    expect(formatStatsValue(1500, 'ms')).toBe('1.50 s');
  });
  it('bytes → B/KiB/MiB/GiB', () => {
    expect(formatStatsValue(512, 'bytes')).toBe('512 B');
    expect(formatStatsValue(2048, 'bytes')).toBe('2.0 KiB');
    expect(formatStatsValue(5 * 1024 * 1024, 'bytes')).toBe('5.00 MiB');
    expect(formatStatsValue(3 * 1024 ** 3, 'bytes')).toBe('3.00 GiB');
  });
  it('count / tokens → M / k / raw', () => {
    expect(formatStatsValue(2_500_000, 'count')).toBe('2.50M');
    expect(formatStatsValue(12_300, 'tokens')).toBe('12.3k');
    expect(formatStatsValue(7, 'count')).toBe('7');
  });
  it('usd → 4 decimals under $1, 2 at/above', () => {
    expect(formatStatsValue(0.0123, 'usd')).toBe('$0.0123');
    expect(formatStatsValue(12.5, 'usd')).toBe('$12.50');
  });
});
