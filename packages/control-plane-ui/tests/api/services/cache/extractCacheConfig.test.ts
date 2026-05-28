import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { extractCacheConfigApi } from '../../../../src/api/services/cache/extractCacheConfig';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('extractCacheConfigApi', () => {
  it('getConfig/saveConfig hit /api/admin/extract-cache/config', () => {
    extractCacheConfigApi.getConfig();
    extractCacheConfigApi.saveConfig({} as never);
    expect(m.get).toHaveBeenCalledWith('/api/admin/extract-cache/config');
    expect(m.put).toHaveBeenCalledWith('/api/admin/extract-cache/config', {});
  });
});
