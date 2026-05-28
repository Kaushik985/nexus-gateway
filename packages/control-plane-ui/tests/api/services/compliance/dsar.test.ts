import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { dsarApi } from '../../../../src/api/services/compliance/dsar';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('dsarApi', () => {
  it('list builds a query string from params', () => {
    dsarApi.list({ status: 'open' as never, limit: 10, offset: 20 });
    expect(m.get).toHaveBeenCalledWith('/api/admin/dsar?status=open&limit=10&offset=20');
  });
  it('list with no params omits the query string', () => {
    dsarApi.list();
    expect(m.get).toHaveBeenCalledWith('/api/admin/dsar');
  });
  it('get/create/update/fulfill hit the right paths (id encoded)', () => {
    dsarApi.get('a/b');
    dsarApi.create({} as never);
    dsarApi.update('a/b', {} as never);
    dsarApi.fulfill('a/b');
    expect(m.get).toHaveBeenCalledWith('/api/admin/dsar/a%2Fb');
    expect(m.post).toHaveBeenCalledWith('/api/admin/dsar', {});
    expect(m.put).toHaveBeenCalledWith('/api/admin/dsar/a%2Fb', {});
    expect(m.post).toHaveBeenCalledWith('/api/admin/dsar/a%2Fb/fulfill', {});
  });
});
