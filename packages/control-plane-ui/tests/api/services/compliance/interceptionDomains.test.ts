import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { interceptionDomainApi } from '../../../../src/api/services/compliance/interceptionDomains';

vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

describe('interceptionDomainApi', () => {
  it('list passes the params through paramsToQuery', () => {
    interceptionDomainApi.list({ search: 'openai', limit: 10 } as never);
    expect(m.get).toHaveBeenCalledWith('/api/admin/interception-domains', expect.objectContaining({ search: 'openai' }));
  });

  it('get / create / update / delete target the domain resource', () => {
    interceptionDomainApi.get('d1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/interception-domains/d1');
    interceptionDomainApi.create({ host: 'x' } as never);
    expect(m.post).toHaveBeenCalledWith('/api/admin/interception-domains', { host: 'x' });
    interceptionDomainApi.update('d1', { host: 'y' } as never);
    expect(m.put).toHaveBeenCalledWith('/api/admin/interception-domains/d1', { host: 'y' });
    interceptionDomainApi.delete('d1');
    expect(m.delete).toHaveBeenCalledWith('/api/admin/interception-domains/d1');
  });

  it('path CRUD nests under the domain', () => {
    interceptionDomainApi.createPath('d1', { path: '/v1' } as never);
    expect(m.post).toHaveBeenCalledWith('/api/admin/interception-domains/d1/paths', { path: '/v1' });
    interceptionDomainApi.updatePath('d1', 'p1', { path: '/v2' } as never);
    expect(m.put).toHaveBeenCalledWith('/api/admin/interception-domains/d1/paths/p1', { path: '/v2' });
    interceptionDomainApi.deletePath('d1', 'p1');
    expect(m.delete).toHaveBeenCalledWith('/api/admin/interception-domains/d1/paths/p1');
  });

  it('listTrafficAdaptersCatalog fetches the built-in adapter ids', () => {
    interceptionDomainApi.listTrafficAdaptersCatalog();
    expect(m.get).toHaveBeenCalledWith('/api/admin/traffic-adapters');
  });
});
