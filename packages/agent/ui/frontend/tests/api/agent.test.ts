import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agentApi } from '@/api/agent';

const binding = {
  GetStatus: vi.fn().mockResolvedValue({ state: 'active' }),
  QueryEvents: vi.fn().mockResolvedValue({ events: [] }),
  EventByID: vi.fn().mockResolvedValue({ id: 'e1' }),
  QueryLifecycleEvents: vi.fn().mockResolvedValue({ events: [] }),
  GetAppliedConfig: vi.fn().mockResolvedValue({}),
  RefreshPolicies: vi.fn().mockResolvedValue({ ok: true }),
  RestartDaemon: vi.fn().mockResolvedValue({ acknowledged: true }),
  PauseProtection: vi.fn().mockResolvedValue({ paused: true }),
  ResumeProtection: vi.fn().mockResolvedValue({ paused: false }),
  CheckUpdate: vi.fn().mockResolvedValue({ available: false }),
  GetDiagnostics: vi.fn().mockResolvedValue({ hubReachable: true }),
  EnrollWithToken: vi.fn().mockResolvedValue({ success: true }),
  AuthenticateSSO: vi.fn().mockResolvedValue({ success: true }),
  AuthenticateConfirm: vi.fn().mockResolvedValue({ success: true }),
  AuthenticateCancel: vi.fn().mockResolvedValue({ acknowledged: true }),
  Unenroll: vi.fn().mockResolvedValue({ acknowledged: true }),
  OpenBrowser: vi.fn().mockResolvedValue({ opened: true }),
  QueryStats: vi.fn().mockResolvedValue({ rows: [] }),
};

describe('agentApi — Wails bridge delegation', () => {
  beforeEach(() => {
    Object.values(binding).forEach((f) => f.mockClear());
    (window as unknown as { go: unknown }).go = { main: { AgentBridge: binding } };
  });
  afterEach(() => { delete (window as unknown as { go?: unknown }).go; });

  it('delegates each method to the matching Go binding (with args)', async () => {
    await agentApi.getStatus();
    expect(binding.GetStatus).toHaveBeenCalled();
    await agentApi.queryEvents({ search: 'x', action: '', offset: 0, limit: 20 });
    expect(binding.QueryEvents).toHaveBeenCalledWith(expect.objectContaining({ search: 'x', limit: 20 }));
    await agentApi.eventById('e1');
    expect(binding.EventByID).toHaveBeenCalledWith('e1');
    await agentApi.queryLifecycle({ offset: 0, limit: 10 });
    expect(binding.QueryLifecycleEvents).toHaveBeenCalledWith({ offset: 0, limit: 10 });
    await agentApi.getAppliedConfig();
    await agentApi.refreshPolicies();
    await agentApi.restartDaemon();
    await agentApi.pauseProtection(300);
    expect(binding.PauseProtection).toHaveBeenCalledWith(300);
    await agentApi.resumeProtection();
    await agentApi.checkUpdate();
    await agentApi.getDiagnostics();
    await agentApi.enrollWithToken('tok');
    expect(binding.EnrollWithToken).toHaveBeenCalledWith('tok');
    await agentApi.authenticateSSO();
    await agentApi.authenticateConfirm();
    await agentApi.authenticateCancel();
    await agentApi.unenroll();
    await agentApi.openBrowser('https://x');
    expect(binding.OpenBrowser).toHaveBeenCalledWith('https://x');
    await agentApi.queryStats({ start: 's', end: 'e', metrics: ['m'], dimension: 'd', subDimension: '' });
    expect(binding.QueryStats).toHaveBeenCalledWith(expect.objectContaining({ start: 's', metrics: ['m'] }));
    // queryStats applies defaults for missing fields:
    await agentApi.queryStats({} as never);
    expect(binding.QueryStats).toHaveBeenLastCalledWith(expect.objectContaining({ start: '', metrics: [], dimension: '' }));
  });

  it('throws NoBridgeError when the Wails bridge is absent', () => {
    delete (window as unknown as { go?: unknown }).go;
    expect(() => agentApi.getStatus()).toThrow();
  });
});
