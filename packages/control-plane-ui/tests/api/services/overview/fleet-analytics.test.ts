import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { fleetAnalyticsApi } from '../../../../src/api/services/overview/fleet-analytics';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
const B = '/api/admin/fleet-analytics';
describe('fleetAnalyticsApi', () => {
  it('summary/trends/topDestinations hit /api/admin/fleet-analytics', () => {
    fleetAnalyticsApi.summary();
    fleetAnalyticsApi.trends({ window: '7d' });
    fleetAnalyticsApi.topDestinations();
    expect(m.get).toHaveBeenCalledWith(`${B}/summary`);
    expect(m.get).toHaveBeenCalledWith(`${B}/trends`, { window: '7d' });
    expect(m.get).toHaveBeenCalledWith(`${B}/top-destinations`, undefined);
  });
});
