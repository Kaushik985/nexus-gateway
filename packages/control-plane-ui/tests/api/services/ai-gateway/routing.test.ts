import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { routingApi } from '../../../../src/api/services/ai-gateway/routing';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('routingApi', () => {
  it('full CRUD + simulate hit /api/admin/routing-rules', () => {
    routingApi.list({ enabled: 'true' } as never);
    routingApi.get('r1');
    routingApi.create({} as never);
    routingApi.update('r1', {} as never);
    routingApi.patch('r1', {} as never);
    routingApi.delete('r1');
    routingApi.simulate({} as never);
    expect(m.get).toHaveBeenCalledWith('/api/admin/routing-rules', { enabled: 'true' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/routing-rules/r1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/routing-rules', {});
    expect(m.put).toHaveBeenCalledWith('/api/admin/routing-rules/r1', {});
    expect(m.patch).toHaveBeenCalledWith('/api/admin/routing-rules/r1', {});
    expect(m.delete).toHaveBeenCalledWith('/api/admin/routing-rules/r1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/routing-rules/simulate', {});
  });
});
