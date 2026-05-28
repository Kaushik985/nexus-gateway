import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { credentialApi, reliabilitySettingsApi } from '../../../../src/api/services/ai-gateway/credentials';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('credentialApi', () => {
  it('CRUD + circuit-reset/probe/reliability', () => {
    credentialApi.list({ providerId: 'p1' });
    credentialApi.get('c1');
    credentialApi.create({} as never);
    credentialApi.update('c1', {} as never);
    credentialApi.delete('c1');
    credentialApi.circuitReset('c1');
    credentialApi.probe('c1');
    credentialApi.updateReliabilityOverrides('c1', null);
    expect(m.get).toHaveBeenCalledWith('/api/admin/credentials', { providerId: 'p1' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/credentials/c1/circuit-reset', {});
    expect(m.post).toHaveBeenCalledWith('/api/admin/credentials/c1/probe', { timeoutSeconds: 5 });
  });
  it('reliabilitySettingsApi get + update', () => {
    reliabilitySettingsApi.get();
    reliabilitySettingsApi.update({} as never);
    expect(m.get).toHaveBeenCalledWith('/api/admin/settings/credential-reliability');
    expect(m.put).toHaveBeenCalledWith('/api/admin/settings/credential-reliability', {});
  });
});
