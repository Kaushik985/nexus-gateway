import { describe, it, expect } from 'vitest';
import { groupOpsSamples, nodeTypeToServiceName } from '../../../../src/pages/status/services/groupOpsSamples';
import type { OpsMetricSample } from '@/api/services/infrastructure/ops/opsmetrics';

function s(over: Partial<OpsMetricSample>): OpsMetricSample {
  return {
    nodeId: 'n1', nodeType: 'control-plane', metricName: 'requests_total',
    metricKind: 'counter', value: 1, sampledAt: '2026-01-01T00:00:00Z', dimensionKey: '',
    ...over,
  } as OpsMetricSample;
}

describe('nodeTypeToServiceName', () => {
  it('returns known service names unchanged + raw for others', () => {
    for (const t of ['control-plane', 'ai-gateway', 'compliance-proxy', 'nexus-hub']) {
      expect(nodeTypeToServiceName(t)).toBe(t);
    }
    expect(nodeTypeToServiceName('mystery')).toBe('mystery');
  });
});

describe('groupOpsSamples', () => {
  it('returns an empty services map for null / empty input', () => {
    expect(groupOpsSamples(null).services).toEqual({});
    expect(groupOpsSamples([]).services).toEqual({});
    expect(typeof groupOpsSamples([]).cachedAt).toBe('string');
  });

  it('SUMs counters across nodes and counts unique instances', () => {
    const out = groupOpsSamples([
      s({ nodeId: 'a', metricName: 'requests_total', metricKind: 'counter', value: 10 }),
      s({ nodeId: 'b', metricName: 'requests_total', metricKind: 'counter', value: 5 }),
      s({ nodeId: 'a', metricName: 'errors_total', metricKind: 'counter', value: 2 }),
    ]);
    expect(out.services['control-plane'].instances).toBe(2);
    expect(out.services['control-plane'].metrics.requestsTotal).toBe(15);
    expect(out.services['control-plane'].metrics.errorsTotal).toBe(2);
  });

  it('takes the LAST gauge by sampledAt and converts heap bytes → MB', () => {
    const out = groupOpsSamples([
      s({ metricName: 'runtime.heap_alloc_bytes', metricKind: 'gauge', value: 1024 * 1024, sampledAt: '2026-01-01T00:00:00Z' }),
      s({ metricName: 'runtime.heap_alloc_bytes', metricKind: 'gauge', value: 4 * 1024 * 1024, sampledAt: '2026-01-01T00:05:00Z' }),
      s({ metricName: 'runtime.goroutines', metricKind: 'gauge', value: 42, sampledAt: '2026-01-01T00:00:00Z' }),
    ]);
    const rt = out.services['control-plane'].runtime;
    expect(rt.heapAllocMB).toBe(4); // last sample wins
    expect(rt.goroutines).toBe(42);
  });

  it('skips null-valued samples and histograms', () => {
    const out = groupOpsSamples([
      s({ metricName: 'requests_total', metricKind: 'counter', value: null as unknown as number }),
      s({ metricName: 'req_duration', metricKind: 'histogram', value: 99 }),
    ]);
    expect(out.services['control-plane'].metrics.requestsTotal).toBe(0);
    // histogram p50/p99 stay 0
    expect(out.services['control-plane'].metrics.requestDurationP50Ms).toBe(0);
  });

  it('maps per-service metrics: control-plane auth/iam', () => {
    const out = groupOpsSamples([
      s({ nodeType: 'control-plane', metricName: 'auth.attempts_total', metricKind: 'counter', value: 7 }),
      s({ nodeType: 'control-plane', metricName: 'iam.eval_total', metricKind: 'counter', value: 3 }),
    ]);
    expect(out.services['control-plane'].metrics.authFailuresTotal).toBe(7);
    expect(out.services['control-plane'].metrics.iamDenialsTotal).toBe(3);
  });

  it('maps per-service metrics: compliance-proxy tunnels + redis gauge', () => {
    const out = groupOpsSamples([
      s({ nodeId: 'p', nodeType: 'compliance-proxy', metricName: 'tunnels.active', metricKind: 'gauge', value: 12 }),
      s({ nodeId: 'p', nodeType: 'compliance-proxy', metricName: 'redis.available', metricKind: 'gauge', value: 1 }),
    ]);
    const m = out.services['compliance-proxy'].metrics;
    expect(m.connectionsActive).toBe(12);
    expect(m.redisAvailable).toBe(true);
  });

  it('maps per-service metrics: ai-gateway prompt tokens', () => {
    const out = groupOpsSamples([
      s({ nodeType: 'ai-gateway', metricName: 'tokens_total', metricKind: 'counter', value: 500 }),
    ]);
    expect(out.services['ai-gateway'].metrics.tokensPromptTotal).toBe(500);
  });
});
