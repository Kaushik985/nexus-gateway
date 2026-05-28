import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { analyticsApi } from '../../../../src/api/services/overview/analytics';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('analyticsApi', () => {
  it('summary/byProvider/cost/usage/metrics/cacheROI/costSummary hit /api/admin/analytics', () => {
    analyticsApi.summary({ window: '7d' });
    analyticsApi.byProvider();
    analyticsApi.cost();
    analyticsApi.usage();
    analyticsApi.metricsAggregates({ g: 'day' });
    analyticsApi.cacheROI();
    analyticsApi.costSummary();
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/summary', { window: '7d' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/by-provider', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/cost', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/usage', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/metrics/aggregates', { g: 'day' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/cost-summary');
  });
  it('sparkline builds a query string when params given', () => {
    analyticsApi.sparkline({ startTime: 's', endTime: 'e' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/sparkline?startTime=s&endTime=e');
    analyticsApi.sparkline();
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/sparkline');
  });
});
