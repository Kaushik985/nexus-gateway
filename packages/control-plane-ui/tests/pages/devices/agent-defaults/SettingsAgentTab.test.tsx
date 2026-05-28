import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SettingsAgentTab } from '@/pages/devices/agent-defaults/SettingsAgentTab';

const dev = vi.hoisted(() => ({ devicesApi: { getAgentSettings: vi.fn(), updateAgentSettings: vi.fn() } }));
vi.mock('@/api/services', () => dev);

const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));

const settings = {
  quitAllowed: false, shutdownWarning: {}, shutdownWarningEnabled: false,
  heartbeatIntervalSec: 60, auditDrainIntervalSec: 30, configSyncIntervalSec: 300, auditBatchSize: 100,
  autoUpdateEnabled: true, autoUpdateChannel: 'stable', logLevel: 'info', trafficUploadLevel: 'processed',
  themeId: '', forceQUICFallbackBundles: [], attestationEnabled: false,
};
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><SettingsAgentTab /></I18nextProvider>);
}

describe('SettingsAgentTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = ok(settings);
    dev.devicesApi.updateAgentSettings.mockResolvedValue({});
  });

  it('hydrates the form fields from the loaded agent settings', () => {
    wrap();
    expect(screen.getByDisplayValue('60')).toBeInTheDocument(); // heartbeatIntervalSec
    expect(screen.getByDisplayValue('300')).toBeInTheDocument(); // configSyncIntervalSec
  });

  it('renders the error branch on failure', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('agent settings failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('agent settings failed')).toBeInTheDocument();
  });

  it('Save is gated on dirty, then persists the flipped quit-policy toggle', async () => {
    wrap();
    const save = screen.getByRole('button', { name: i18n.t('common:save') });
    expect(save).toBeDisabled(); // clean form
    // the first switch is the Agent Quit Policy toggle
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(dev.devicesApi.updateAgentSettings).toHaveBeenCalledWith(
      expect.objectContaining({ quitAllowed: true, heartbeatIntervalSec: 60, autoUpdateChannel: 'stable' }),
    ));
  });
});
