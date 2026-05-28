import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { agentEventsApi } from '../../../../src/api/services/system/agent-events';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('agentEventsApi', () => {
  it('search + export hit /api/admin/agent-events', () => {
    agentEventsApi.search({ q: 'x' });
    agentEventsApi.export({ format: 'csv' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-events', { q: 'x' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-events/export', { format: 'csv' });
  });
});
