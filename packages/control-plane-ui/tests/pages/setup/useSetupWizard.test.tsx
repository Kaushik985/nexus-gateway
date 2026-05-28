import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSetupWizard, checkAllSetupComplete, STEP_IDS, TOTAL_STEPS } from '@/pages/setup/useSetupWizard';

const api = vi.hoisted(() => ({
  organizationApi: { list: vi.fn() },
  providerApi: { list: vi.fn() },
  credentialApi: { list: vi.fn() },
  projectApi: { list: vi.fn() },
  virtualKeyApi: { list: vi.fn() },
  routingApi: { list: vi.fn() },
  systemApi: { listModels: vi.fn() },
}));
vi.mock('@/api/services', () => api);

function emptyAll() {
  for (const k of Object.keys(api) as (keyof typeof api)[]) {
    for (const fn of Object.values(api[k])) (fn as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
  }
}

describe('useSetupWizard navigation', () => {
  beforeEach(emptyAll);

  it('goNext / goBack / goToStep respect bounds', async () => {
    const { result } = renderHook(() => useSetupWizard());
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    act(() => result.current.goToStep(0));
    act(() => result.current.goBack());
    expect(result.current.currentStep).toBe(0);
    for (let i = 0; i < TOTAL_STEPS + 3; i++) act(() => result.current.goNext());
    expect(result.current.currentStep).toBe(TOTAL_STEPS);
    expect(result.current.isOnSummary).toBe(true);
    act(() => result.current.goToStep(99 as never));
    expect(result.current.currentStep).toBe(TOTAL_STEPS);
  });

  it('skip/completeCompliance set the step result and advance', async () => {
    const { result } = renderHook(() => useSetupWizard());
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    act(() => result.current.goToStep(0));
    act(() => result.current.skipCompliance());
    expect(result.current.results.compliance.status).toBe('skipped');
    act(() => result.current.completeCompliance());
    expect(result.current.results.compliance.status).toBe('complete');
  });

  it('allRequiredComplete is false when required steps are not complete', async () => {
    const { result } = renderHook(() => useSetupWizard());
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    expect(result.current.allRequiredComplete).toBe(false);
    expect(STEP_IDS.length).toBe(TOTAL_STEPS);
  });
});

describe('checkAllSetupComplete', () => {
  beforeEach(emptyAll);

  it('is false when any required entity is missing', async () => {
    expect(await checkAllSetupComplete()).toBe(false);
  });

  it('is true when every required entity is present + a provider has a credential', async () => {
    api.organizationApi.list.mockResolvedValue({ data: [{ id: 'o1' }] });
    api.providerApi.list.mockResolvedValue({ data: [{ id: 'p1', enabled: true }] });
    api.credentialApi.list.mockResolvedValue({ data: [{ id: 'c1', providerId: 'p1' }] });
    api.projectApi.list.mockResolvedValue({ data: [{ id: 'pr1' }] });
    api.virtualKeyApi.list.mockResolvedValue({ data: [{ id: 'vk1' }] });
    api.routingApi.list.mockResolvedValue({ data: [{ id: 'r1' }] });
    expect(await checkAllSetupComplete()).toBe(true);
  });

  it('is false when a provider exists but has no credential', async () => {
    api.organizationApi.list.mockResolvedValue({ data: [{ id: 'o1' }] });
    api.providerApi.list.mockResolvedValue({ data: [{ id: 'p1', enabled: true }] });
    api.credentialApi.list.mockResolvedValue({ data: [{ id: 'c1', providerId: 'other' }] });
    api.projectApi.list.mockResolvedValue({ data: [{ id: 'pr1' }] });
    api.virtualKeyApi.list.mockResolvedValue({ data: [{ id: 'vk1' }] });
    api.routingApi.list.mockResolvedValue({ data: [{ id: 'r1' }] });
    expect(await checkAllSetupComplete()).toBe(false);
  });

  it('is false (caught) when a list call rejects', async () => {
    api.organizationApi.list.mockRejectedValue(new Error('boom'));
    expect(await checkAllSetupComplete()).toBe(false);
  });
});
