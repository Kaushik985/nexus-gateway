import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SettingsCredentialReliabilityTab } from '@/pages/ai-gateway/credentials/reliability/SettingsCredentialReliabilityTab';

const svc = vi.hoisted(() => ({ reliabilitySettingsApi: { get: vi.fn(), update: vi.fn() } }));
vi.mock('@/api/services', () => svc);
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const thresholds = { authFailThreshold: 5, rateLimitCooldownSeconds: 60, healthyThresholdPct: 95, degradedThresholdPct: 80, healthMinSamples: 10, healthWindowSeconds: 300, healthSustainedDegradedSeconds: 120 };
const defaults = { ...thresholds, authFailThreshold: 3 };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><SettingsCredentialReliabilityTab /></I18nextProvider>);
}

describe('SettingsCredentialReliabilityTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = ok({ effective: thresholds, defaults });
    svc.reliabilitySettingsApi.update.mockResolvedValue({});
  });

  it('renders the threshold form hydrated from the effective config', () => {
    wrap();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument(); // authFailThreshold
    expect(screen.getByDisplayValue('95')).toBeInTheDocument(); // healthyThresholdPct
  });

  it('renders the skeleton while loading', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
  });

  it('Save persists the thresholds via the settings API', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(svc.reliabilitySettingsApi.update).toHaveBeenCalled());
  });

  it('Reset to defaults rehydrates the form from the default thresholds', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('pages:settings.reliability.resetDefaults', 'Reset'), 'i') }));
    // authFailThreshold default is 3
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });
});
