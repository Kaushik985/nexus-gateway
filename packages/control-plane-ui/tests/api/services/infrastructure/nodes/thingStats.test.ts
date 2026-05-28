import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../../src/api/client';
import { thingStatsApi } from '../../../../../src/api/services/infrastructure/nodes/thingStats';
vi.mock('../../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('thingStatsApi', () => {
  it('get builds the stats path (thingId encoded, no params → no qs)', () => {
    thingStatsApi.get('a/b');
    expect(m.get).toHaveBeenCalledWith('/api/admin/things/a%2Fb/stats');
  });
  it('get appends a query string when params are supplied', () => {
    thingStatsApi.get('t1', { start: 's', end: 'e', metric: 'cost' });
    const url = m.get.mock.calls.at(-1)![0] as string;
    expect(url.startsWith('/api/admin/things/t1/stats')).toBe(true);
    expect(url).toContain('start=s');
    expect(url).toContain('metric=cost');
  });
});
