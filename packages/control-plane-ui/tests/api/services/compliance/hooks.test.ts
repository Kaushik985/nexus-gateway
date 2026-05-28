import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { hookApi } from '../../../../src/api/services/compliance/hooks';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('hookApi', () => {
  it('CRUD + dry-run/test/implementations/chain/reorder', () => {
    hookApi.list({ stage: 'request' });
    hookApi.get('h1');
    hookApi.create({} as never);
    hookApi.update('h1', {} as never);
    hookApi.delete('h1');
    hookApi.dryRun('h1', {} as never);
    hookApi.test('h1', {} as never);
    hookApi.getImplementations();
    hookApi.getExecutionChain();
    hookApi.reorder({} as never);
    expect(m.get).toHaveBeenCalledWith('/api/admin/hooks', { stage: 'request' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/hooks', {});
    expect(m.put).toHaveBeenCalledWith('/api/admin/hooks/h1', {});
    expect(m.delete).toHaveBeenCalledWith('/api/admin/hooks/h1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/hooks/h1/dry-run', {});
    expect(m.get).toHaveBeenCalledWith('/api/admin/hooks/implementations');
    expect(m.get).toHaveBeenCalledWith('/api/admin/hooks/execution-chain');
    expect(m.post).toHaveBeenCalledWith('/api/admin/hooks/reorder', {});
  });
});
