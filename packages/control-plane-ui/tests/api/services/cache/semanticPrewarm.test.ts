import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { prewarm } from '../../../../src/api/services/cache/semanticPrewarm';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('prewarm', () => {
  it('POSTs to /api/admin/semantic-cache/prewarm', () => {
    prewarm({ entries: [] } as never);
    expect(m.post).toHaveBeenCalledWith('/api/admin/semantic-cache/prewarm', { entries: [] });
  });
});
