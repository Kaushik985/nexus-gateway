import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SettingsSiemTab } from '@/pages/infrastructure/siem/SettingsSiemTab';

const sys = vi.hoisted(() => ({ systemApi: { getSiemConfig: vi.fn(), listSiemEventTypes: vi.fn(), updateSiemConfig: vi.fn(), sendSiemTestEvent: vi.fn() } }));
// SettingsSiemTab imports systemApi from the deep module path, not the barrel.
vi.mock('@/api/services/infrastructure/misc/system', () => sys);

const apiByKey = vi.hoisted(() => ({ config: undefined as unknown, events: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) => (key.includes('event-types') ? apiByKey.events : apiByKey.config),
}));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));

const config = { enabled: true, url: 'https://siem.example.com/ingest', format: 'cef', headers: { Authorization: 'Bearer x' }, eventTypes: ['provider.read'] };
const events = { eventTypes: [{ type: 'provider.read', resource: 'provider', service: 'gateway' }] };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }

function wrap() {
  return render(<I18nextProvider i18n={i18n}><SettingsSiemTab /></I18nextProvider>);
}

describe('SettingsSiemTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.config = ok(config);
    apiByKey.events = ok(events);
    sys.systemApi.updateSiemConfig.mockResolvedValue({});
    sys.systemApi.sendSiemTestEvent.mockResolvedValue({ ok: true });
  });

  it('hydrates the form from the loaded SIEM config', () => {
    wrap();
    expect(screen.getByDisplayValue('https://siem.example.com/ingest')).toBeInTheDocument();
  });

  it('renders the error branch when the config load fails', () => {
    apiByKey.config = { data: undefined, loading: false, error: new Error('siem load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('siem load failed')).toBeInTheDocument();
  });

  it('Save persists the edited URL via updateSiemConfig with merged headers', async () => {
    wrap();
    fireEvent.change(screen.getByDisplayValue('https://siem.example.com/ingest'), { target: { value: 'https://new.siem/in' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(sys.systemApi.updateSiemConfig).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://new.siem/in', headers: { Authorization: 'Bearer x' } }),
    ));
  });

  it('adding a header row threads it into the saved headers map', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:add') }));
    const names = screen.getAllByPlaceholderText(i18n.t('pages:settingsSiem.headerNamePlaceholder'));
    const values = screen.getAllByPlaceholderText(i18n.t('pages:settingsSiem.headerValuePlaceholder'));
    fireEvent.change(names.at(-1)!, { target: { value: 'X-Token' } });
    fireEvent.change(values.at(-1)!, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(sys.systemApi.updateSiemConfig).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Token': 'abc' }) }),
    ));
  });

  it('Send Test calls sendSiemTestEvent and surfaces the success result', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:settingsSiem.testButton') }));
    await waitFor(() => expect(sys.systemApi.sendSiemTestEvent).toHaveBeenCalled());
    expect(screen.getByText(i18n.t('pages:settingsSiem.testSuccess'))).toBeInTheDocument();
  });
});
