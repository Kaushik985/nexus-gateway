import { describe, it, expect } from 'vitest';
import {
  isProviderRollupRow,
  rowsForMetricChart,
  formatBucketAxis,
  sumMetricByBucket,
  avgMetricByBucket,
  sumPointValues,
  pivotProviderMetricByBucket,
} from '../../../src/pages/metrics/metrics-aggregates-helpers';
import type { MetricAggregatePoint } from '../../../src/api/types';

const row = (over: Partial<MetricAggregatePoint>): MetricAggregatePoint => ({
  metricName: 'request_count', dimensionKey: '', bucketStart: '2026-01-01T00:00:00Z', value: '1',
  ...over,
} as MetricAggregatePoint);

describe('isProviderRollupRow / rowsForMetricChart', () => {
  it('detects routed_provider-keyed rows', () => {
    expect(isProviderRollupRow(row({ dimensionKey: 'routed_provider:p1' }))).toBe(true);
    expect(isProviderRollupRow(row({ dimensionKey: 'model:m1' }))).toBe(false);
  });
  it('prefers provider rows for a metric, else falls back to all rows', () => {
    const rows = [
      row({ metricName: 'request_count', dimensionKey: 'routed_provider:p1' }),
      row({ metricName: 'request_count', dimensionKey: '' }),
      row({ metricName: 'other', dimensionKey: '' }),
    ];
    expect(rowsForMetricChart(rows, 'request_count')).toHaveLength(1); // only the provider row
    expect(rowsForMetricChart(rows, 'other')).toHaveLength(1); // no provider rows → all for metric
  });
});

describe('formatBucketAxis', () => {
  it('renders HH:MM within 48h, full datetime beyond', () => {
    expect(formatBucketAxis('2026-01-01T08:30:00Z', 24)).toBe('08:30');
    expect(formatBucketAxis('2026-01-01T08:30:00Z', 72)).not.toBe('08:30');
  });
});

describe('sumMetricByBucket / sumPointValues / avgMetricByBucket', () => {
  const rows = [
    row({ bucketStart: '2026-01-01T00:00:00Z', value: '3' }),
    row({ bucketStart: '2026-01-01T00:00:00Z', value: '2' }),
    row({ bucketStart: '2026-01-01T01:00:00Z', value: '5' }),
    row({ bucketStart: '2026-01-01T01:00:00Z', value: 'NaN' }), // skipped
  ];
  it('sums per bucket, sorted, ignoring non-finite', () => {
    const out = sumMetricByBucket(rows, 'request_count');
    expect(out.map((b) => b.total)).toEqual([5, 5]);
    expect(out[0].bucketAt < out[1].bucketAt).toBe(true);
  });
  it('sumPointValues totals all finite values', () => {
    expect(sumPointValues(rows)).toBe(10);
  });
  it('avgMetricByBucket = sum/count per bucket', () => {
    const r = [
      row({ metricName: 'lat_sum', bucketStart: 'b1', value: '100' }),
      row({ metricName: 'lat_count', bucketStart: 'b1', value: '4' }),
    ];
    const out = avgMetricByBucket(r, 'lat_sum', 'lat_count');
    expect(out[0].avg).toBe(25);
  });
});

describe('pivotProviderMetricByBucket', () => {
  it('pivots one column per provider (label preferred over id)', () => {
    const rows = [
      row({ bucketStart: 'b1', value: '10', dimensions: { provider: 'p1', providerLabel: 'OpenAI' } }),
      row({ bucketStart: 'b1', value: '5', dimensions: { provider: 'p2' } }),
      row({ bucketStart: 'b2', value: '7', dimensions: { provider: 'p1', providerLabel: 'OpenAI' } }),
    ] as MetricAggregatePoint[];
    const { data, providers } = pivotProviderMetricByBucket(rows, 'request_count');
    expect(providers).toEqual(expect.arrayContaining(['OpenAI', 'p2']));
    expect(data).toHaveLength(2); // two buckets
  });
});
