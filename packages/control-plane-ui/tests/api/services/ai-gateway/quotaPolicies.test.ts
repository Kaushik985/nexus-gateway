import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { quotaPolicyApi } from '../../../../src/api/services/ai-gateway/quotaPolicies';

vi.mock('../../../../src/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) },
}));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>;

describe('quotaPolicyApi', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
  it('CRUD hits /api/admin/quota-policies', () => {
    quotaPolicyApi.list({ scope: 'org' });
    quotaPolicyApi.get('q1');
    quotaPolicyApi.create({ name: 'N', scope: 'org', periodType: 'monthly', enforcementMode: 'hard' });
    quotaPolicyApi.update('q1', { enabled: false });
    quotaPolicyApi.delete('q1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/quota-policies', { scope: 'org' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/quota-policies/q1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/quota-policies', expect.objectContaining({ name: 'N' }));
    expect(m.put).toHaveBeenCalledWith('/api/admin/quota-policies/q1', { enabled: false });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/quota-policies/q1');
  });
});
