import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { quotaOverrideApi } from '../../../../src/api/services/ai-gateway/quotaOverrides';

vi.mock('../../../../src/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) },
}));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>;

describe('quotaOverrideApi', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
  it('CRUD hits /api/admin/quota-overrides', () => {
    quotaOverrideApi.list();
    quotaOverrideApi.get('o1');
    quotaOverrideApi.create({ targetType: 'vk', targetId: 't1' });
    quotaOverrideApi.update('o1', { reason: 'r' });
    quotaOverrideApi.delete('o1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/quota-overrides', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/quota-overrides/o1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/quota-overrides', { targetType: 'vk', targetId: 't1' });
    expect(m.put).toHaveBeenCalledWith('/api/admin/quota-overrides/o1', { reason: 'r' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/quota-overrides/o1');
  });
});
