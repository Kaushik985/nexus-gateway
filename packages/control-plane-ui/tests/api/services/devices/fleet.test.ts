import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { fleetApi } from '../../../../src/api/services/devices/fleet';

vi.mock('../../../../src/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) },
}));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>;

// Fleet management — agent-users + agent-devices + device-auth settings.
describe('fleetApi', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
  it('agent-user reads + suspend/activate hit the right paths', () => {
    fleetApi.listAgentUsers({ q: 'a' });
    fleetApi.getAgentUser('u1');
    fleetApi.getUserDevices('u1', { offset: '0' });
    fleetApi.getUserAudit('u1');
    fleetApi.suspendUser('u1');
    fleetApi.activateUser('u1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-users', { q: 'a' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-users/u1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-users/u1/devices', { offset: '0' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-users/u1/audit', undefined);
    expect(m.post).toHaveBeenCalledWith('/api/admin/agent-users/u1/suspend');
    expect(m.post).toHaveBeenCalledWith('/api/admin/agent-users/u1/activate');
  });
  it('agent-device reads hit the right paths', () => {
    fleetApi.getDeviceAudit('d1');
    fleetApi.getDeviceConfig('d1');
    fleetApi.getDeviceTimeline('d1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-devices/d1/audit', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-devices/d1/config');
    expect(m.get).toHaveBeenCalledWith('/api/admin/agent-devices/d1/timeline');
  });
  it('device-auth settings get + update', () => {
    fleetApi.getDeviceAuthSettings();
    fleetApi.updateDeviceAuthSettings({ mode: 'sso' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/settings/device-auth');
    expect(m.put).toHaveBeenCalledWith('/api/admin/settings/device-auth', { mode: 'sso' });
  });
});
