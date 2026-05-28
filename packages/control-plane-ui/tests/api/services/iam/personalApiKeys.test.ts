import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { personalApiKeyApi } from '../../../../src/api/services/iam/personalApiKeys';

vi.mock('../../../../src/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) },
}));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>;

// Personal keys use /api/my/* (ownership-enforced, no IAM gate).
describe('personalApiKeyApi', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
  it('list / create / delete / regenerate hit /api/my/api-keys', () => {
    personalApiKeyApi.list();
    personalApiKeyApi.create({ name: 'k' });
    personalApiKeyApi.delete('k1');
    personalApiKeyApi.regenerate('k1');
    expect(m.get).toHaveBeenCalledWith('/api/my/api-keys');
    expect(m.post).toHaveBeenCalledWith('/api/my/api-keys', { name: 'k' });
    expect(m.delete).toHaveBeenCalledWith('/api/my/api-keys/k1');
    expect(m.post).toHaveBeenCalledWith('/api/my/api-keys/k1/regenerate', {});
  });
});
