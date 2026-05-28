import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { cacheApi, familyOf } from '../../../../src/api/services/system/cache';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('cacheApi', () => {
  it('global/adapter/provider/effective/overrides routes', () => {
    cacheApi.getGlobal();
    cacheApi.putGlobal({} as never);
    cacheApi.listAdapters();
    cacheApi.getAdapter('a/b');
    cacheApi.putAdapter('a/b', {} as never);
    cacheApi.getProvider('p1');
    cacheApi.putProvider('p1', {} as never);
    cacheApi.deleteProvider('p1');
    cacheApi.getEffective('p1');
    cacheApi.listOverrides();
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/global');
    expect(m.put).toHaveBeenCalledWith('/api/admin/cache/global', {});
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/adapters');
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/adapter/a%2Fb');
    expect(m.delete).toHaveBeenCalledWith('/api/admin/cache/provider/p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/effective?provider_id=p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/overrides');
  });
});
describe('familyOf', () => {
  it('maps adapter types to a cache family', () => {
    expect(familyOf('anthropic')).toBe('anthropic');
    expect(familyOf('bedrock')).toBe('anthropic');
    expect(familyOf('gemini')).toBe('gemini');
    expect(familyOf('vertex')).toBe('gemini');
    expect(familyOf('openai')).toBe('none');
  });
});
