import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { semanticCacheConfigApi } from '../../../../src/api/services/cache/semanticCacheConfig';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('semanticCacheConfigApi', () => {
  it('getConfig/saveConfig/runProbe', () => {
    semanticCacheConfigApi.getConfig();
    semanticCacheConfigApi.saveConfig({} as never);
    semanticCacheConfigApi.runProbe('p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/semantic-cache/config');
    expect(m.put).toHaveBeenCalledWith('/api/admin/semantic-cache/config', {});
    expect(m.post).toHaveBeenCalledWith('/api/admin/providers/p1/embedding-probe', {});
  });
});
