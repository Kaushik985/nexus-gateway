import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { organizationApi } from '../../../../src/api/services/iam/organizations';

vi.mock('../../../../src/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) },
}));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>;

describe('organizationApi', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
  it('list + tree hit their paths', () => {
    organizationApi.list();
    organizationApi.tree({ depth: '2' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/organizations', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/organizations/tree', { depth: '2' });
  });
  it('get / create / update / delete', () => {
    organizationApi.get('o1');
    organizationApi.create({ name: 'N', code: 'C' });
    organizationApi.update('o1', { name: 'N2' });
    organizationApi.delete('o1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/organizations/o1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/organizations', { name: 'N', code: 'C' });
    expect(m.put).toHaveBeenCalledWith('/api/admin/organizations/o1', { name: 'N2' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/organizations/o1');
  });
});
