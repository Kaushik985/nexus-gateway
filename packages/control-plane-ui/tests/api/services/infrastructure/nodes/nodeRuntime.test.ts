import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../../src/api/client';
import { nodeRuntimeApi } from '../../../../../src/api/services/infrastructure/nodes/nodeRuntime';
vi.mock('../../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('nodeRuntimeApi', () => {
  it('get hits /api/admin/nodes/:id/runtime', () => {
    nodeRuntimeApi.get('n1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/nodes/n1/runtime');
  });
});
