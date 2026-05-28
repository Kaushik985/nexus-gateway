import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { virtualKeyApi } from '../../../../src/api/services/ai-gateway/virtualKeys';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('virtualKeyApi', () => {
  it('CRUD + lifecycle actions hit /api/admin/virtual-keys', () => {
    virtualKeyApi.list({ status: 'active' });
    virtualKeyApi.get('v1');
    virtualKeyApi.create({} as never);
    virtualKeyApi.update('v1', {} as never);
    virtualKeyApi.delete('v1');
    virtualKeyApi.regenerate('v1');
    virtualKeyApi.approve('v1');
    virtualKeyApi.reject('v1', 'nope');
    virtualKeyApi.renew('v1', '2026-12-31');
    virtualKeyApi.revoke('v1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/virtual-keys', { status: 'active' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/virtual-keys/v1');
    expect(m.delete).toHaveBeenCalledWith('/api/admin/virtual-keys/v1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/virtual-keys/v1/regenerate', {});
    expect(m.post).toHaveBeenCalledWith('/api/admin/virtual-keys/v1/approve', {});
    expect(m.post).toHaveBeenCalledWith('/api/admin/virtual-keys/v1/reject', { reason: 'nope' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/virtual-keys/v1/renew', { expiresAt: '2026-12-31' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/virtual-keys/v1/revoke', {});
  });
});
