import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { aiGuardApi } from '../../../../src/api/services/compliance/aiguard';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('aiGuardApi', () => {
  it('getConfig/saveConfig/dryRun hit /api/admin/ai-guard', () => {
    aiGuardApi.getConfig();
    aiGuardApi.saveConfig({ enabled: true } as never);
    aiGuardApi.dryRun({ text: 't' } as never);
    expect(m.get).toHaveBeenCalledWith('/api/admin/ai-guard/config');
    expect(m.put).toHaveBeenCalledWith('/api/admin/ai-guard/config', { enabled: true });
    expect(m.post).toHaveBeenCalledWith('/api/admin/ai-guard/dry-run', { text: 't' });
  });
});
