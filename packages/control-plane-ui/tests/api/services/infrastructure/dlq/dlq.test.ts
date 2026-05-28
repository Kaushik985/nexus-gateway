import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../../src/api/client';
import { dlqApi } from '../../../../../src/api/services/infrastructure/dlq/dlq';
vi.mock('../../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('dlqApi', () => {
  it('list (with + without query) and retry (id encoded)', () => {
    dlqApi.list();
    dlqApi.retry('a/b');
    expect(m.get).toHaveBeenCalledWith('/api/admin/observability/dlq');
    expect(m.post).toHaveBeenCalledWith('/api/admin/observability/dlq/a%2Fb/retry');
  });
  it('list forwards filter params in the query string', () => {
    dlqApi.list({ subject: 'traffic.x', limit: 10, offset: 20 });
    const url = m.get.mock.calls.at(-1)![0] as string;
    expect(url.startsWith('/api/admin/observability/dlq?')).toBe(true);
    expect(url).toContain('subject=traffic.x');
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=20');
  });
});
