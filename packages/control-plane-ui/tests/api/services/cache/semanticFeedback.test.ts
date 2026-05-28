import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { semanticFeedbackApi } from '../../../../src/api/services/cache/semanticFeedback';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('semanticFeedbackApi', () => {
  it('postFeedback + listFeedback (default + explicit limit)', () => {
    semanticFeedbackApi.postFeedback({ key: 'k' } as never);
    semanticFeedbackApi.listFeedback();
    semanticFeedbackApi.listFeedback(50);
    expect(m.post).toHaveBeenCalledWith('/api/admin/cache/semantic-feedback', { key: 'k' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/semantic-feedback?limit=100');
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/semantic-feedback?limit=50');
  });
});
