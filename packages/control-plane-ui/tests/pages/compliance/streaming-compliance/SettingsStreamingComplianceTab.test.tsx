/**
 * SettingsStreamingComplianceTab — mocked-useApi config: render title, Save →
 * updateStreamingComplianceConfig with the loaded config, loading/error.
 * Replaces the smoke test. systemApi is the deep infrastructure/misc/system path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SettingsStreamingComplianceTab } from '@/pages/compliance/streaming-compliance/SettingsStreamingComplianceTab';

vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: () => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async () => { await fn(); opts?.onSuccess?.(); }, loading: false,
  }),
}));
const sysApi = vi.hoisted(() => ({ systemApi: { getStreamingComplianceConfig: vi.fn(), updateStreamingComplianceConfig: vi.fn() } }));
vi.mock('@/api/services/infrastructure/misc/system', () => sysApi);
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const config = {
  default_mode: 'buffer', chunk_bytes: 4096, hook_timeout_ms: 1000, max_buffer_bytes: 1048576,
  fail_behavior: 'fail_open', capture_request_body: false, capture_response_body: false, raw_body_spill_enabled: false,
};
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><SettingsStreamingComplianceTab /></I18nextProvider>); }

describe('SettingsStreamingComplianceTab', () => {
  beforeEach(() => { vi.clearAllMocks(); sysApi.systemApi.updateStreamingComplianceConfig.mockResolvedValue({}); apiState.value = ok(config); });

  it('renders the streaming-compliance title', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:settingsStreamingCompliance.title', 'Streaming Compliance'))).toBeInTheDocument();
  });

  it('Save sends the loaded config to updateStreamingComplianceConfig', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(sysApi.systemApi.updateStreamingComplianceConfig).toHaveBeenCalledWith(
      expect.objectContaining({ default_mode: 'buffer', chunk_bytes: 4096, fail_behavior: 'fail_open' }),
    ));
  });

  it('renders the error branch', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('streaming config failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('streaming config failed')).toBeInTheDocument();
  });
});
