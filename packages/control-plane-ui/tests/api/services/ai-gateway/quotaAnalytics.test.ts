import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { quotaAnalyticsApi } from '../../../../src/api/services/ai-gateway/quotaAnalytics';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('quotaAnalyticsApi', () => {
  it('overview/trend/top hit /api/admin/quota-analytics', () => {
    quotaAnalyticsApi.overview({ scope: 'org' });
    quotaAnalyticsApi.trend({ scope: 'org' });
    quotaAnalyticsApi.top({ scope: 'org' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/quota-analytics/overview', { scope: 'org' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/quota-analytics/trend', { scope: 'org' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/quota-analytics/top', { scope: 'org' });
  });
});
