import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { projectApi } from '../../../../src/api/services/iam/projects';

vi.mock('../../../../src/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) },
}));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>;

// Pins the admin Projects API contract (path + method + body) the SPA sends.
describe('projectApi', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
  it('list GETs /api/admin/projects with params', () => {
    projectApi.list({ q: 'x' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/projects', { q: 'x' });
  });
  it('get GETs the by-id path', () => {
    projectApi.get('p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/projects/p1');
  });
  it('create POSTs the body', () => {
    projectApi.create({ name: 'N', code: 'C' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/projects', { name: 'N', code: 'C' });
  });
  it('update PUTs to the by-id path', () => {
    projectApi.update('p1', { name: 'N2' });
    expect(m.put).toHaveBeenCalledWith('/api/admin/projects/p1', { name: 'N2' });
  });
  it('delete DELETEs the by-id path', () => {
    projectApi.delete('p1');
    expect(m.delete).toHaveBeenCalledWith('/api/admin/projects/p1');
  });
});
