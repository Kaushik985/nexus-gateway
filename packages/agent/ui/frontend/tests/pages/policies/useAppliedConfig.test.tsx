import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAppliedConfig, useRefreshPolicies } from '../../../src/pages/policies/useAppliedConfig';

const getAppliedConfig = vi.fn();
const refreshPolicies = vi.fn();
vi.mock('@/api/agent', () => ({
  agentApi: {
    getAppliedConfig: () => getAppliedConfig(),
    refreshPolicies: () => refreshPolicies(),
  },
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useAppliedConfig', () => {
  beforeEach(() => {
    getAppliedConfig.mockReset();
    refreshPolicies.mockReset();
  });

  it('subscribes to GET_APPLIED_CONFIG and surfaces the snapshot', async () => {
    getAppliedConfig.mockResolvedValue({ syncStatus: { state: 'synced' } });
    const { result } = renderHook(() => useAppliedConfig(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ syncStatus: { state: 'synced' } });
    expect(getAppliedConfig).toHaveBeenCalled();
  });
});

describe('useRefreshPolicies', () => {
  beforeEach(() => {
    getAppliedConfig.mockResolvedValue({});
    refreshPolicies.mockReset();
  });

  it('trigger() flips refreshing and invalidates on success', async () => {
    refreshPolicies.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useRefreshPolicies(), { wrapper: wrapper() });
    expect(result.current.refreshing).toBe(false);
    await act(async () => {
      await result.current.trigger();
    });
    expect(refreshPolicies).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces the daemon error when the IPC returns ok=false', async () => {
    refreshPolicies.mockResolvedValue({ ok: false, error: 'sync in progress' });
    const { result } = renderHook(() => useRefreshPolicies(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.error).toBe('sync in progress');
  });

  it('catches a thrown IPC and records its message; clearError resets it', async () => {
    refreshPolicies.mockRejectedValue(new Error('bridge offline'));
    const { result } = renderHook(() => useRefreshPolicies(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.error).toBe('bridge offline');
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
