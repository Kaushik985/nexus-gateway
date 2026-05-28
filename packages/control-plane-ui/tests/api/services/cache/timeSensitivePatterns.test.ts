import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { timeSensitivePatternsApi } from '../../../../src/api/services/cache/timeSensitivePatterns';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('timeSensitivePatternsApi', () => {
  it('CRUD + test (id encoded)', () => {
    timeSensitivePatternsApi.list();
    timeSensitivePatternsApi.update('a/b', {} as never);
    timeSensitivePatternsApi.create({} as never);
    timeSensitivePatternsApi.delete('a/b');
    timeSensitivePatternsApi.test('what time is it', 'en');
    expect(m.get).toHaveBeenCalledWith('/api/admin/cache/time-sensitive-patterns');
    expect(m.put).toHaveBeenCalledWith('/api/admin/cache/time-sensitive-patterns/a%2Fb', {});
    expect(m.post).toHaveBeenCalledWith('/api/admin/cache/time-sensitive-patterns', {});
    expect(m.delete).toHaveBeenCalledWith('/api/admin/cache/time-sensitive-patterns/a%2Fb');
    expect(m.post).toHaveBeenCalledWith('/api/admin/cache/time-sensitive-patterns/test', { prompt: 'what time is it', language: 'en' });
  });
});
