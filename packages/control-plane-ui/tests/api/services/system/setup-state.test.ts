import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { setupStateApi } from '../../../../src/api/services/system/setup-state';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('setupStateApi', () => {
  it('get + put hit /api/admin/setup-state', () => {
    setupStateApi.get();
    setupStateApi.put({ completed: true, steps: {} });
    expect(m.get).toHaveBeenCalledWith('/api/admin/setup-state');
    expect(m.put).toHaveBeenCalledWith('/api/admin/setup-state', { completed: true, steps: {} });
  });
});
