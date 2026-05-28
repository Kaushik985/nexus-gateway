/**
 * SettingsObservabilityTab — mocked-useApi config: render current config,
 * toggle OTel + Save → updateObservabilityConfig, loading/error. Replaces the
 * smoke test. systemApi is imported from the deep infrastructure/misc/system
 * path (not the barrel), so the mock targets that path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SettingsObservabilityTab } from '@/pages/infrastructure/observability/SettingsObservabilityTab';

vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: () => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async () => { await fn(); opts?.onSuccess?.(); }, loading: false,
  }),
}));
const sysApi = vi.hoisted(() => ({ systemApi: { getObservabilityConfig: vi.fn(), updateObservabilityConfig: vi.fn() } }));
vi.mock('@/api/services/infrastructure/misc/system', () => sysApi);
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const config = { otelEnabled: false, samplingRate: 0.1, traceViewerUrl: '', otelEndpoint: 'http://otel:4317', otelServiceName: 'nexus' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><SettingsObservabilityTab /></I18nextProvider>); }

describe('SettingsObservabilityTab', () => {
  beforeEach(() => { vi.clearAllMocks(); sysApi.systemApi.updateObservabilityConfig.mockResolvedValue({}); apiState.value = ok(config); });

  it('renders the title + current OTel endpoint', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:settingsObservability.title'))).toBeInTheDocument();
    expect(screen.getByText('http://otel:4317')).toBeInTheDocument();
  });

  it('enabling OTel then Save persists the updated config', async () => {
    wrap();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(sysApi.systemApi.updateObservabilityConfig).toHaveBeenCalledWith(expect.objectContaining({ otelEnabled: true })));
  });

  it('renders the error branch', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('obs config failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('obs config failed')).toBeInTheDocument();
  });
});
