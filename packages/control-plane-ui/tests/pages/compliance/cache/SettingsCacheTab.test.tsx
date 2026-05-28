/**
 * SettingsCacheTab — focused on the GlobalPanel (normaliser + kill-switch
 * toggles → cacheApi.putGlobal) with the other three panels left in their empty
 * branches. Replaces the render-without-crashing smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SettingsCacheTab } from '@/pages/compliance/cache/SettingsCacheTab';

const apiState = vi.hoisted(() => ({ global: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
// only the GlobalPanel key returns data; the adapter/adapters/overrides panels
// fall into their empty/loading branches (undefined data) and stay quiet.
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) =>
    key[key.length - 1] === 'global' ? apiState.global : { data: undefined, loading: false, error: null, refetch: vi.fn() },
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: () => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async () => { await fn(); opts?.onSuccess?.(); },
    loading: false,
  }),
}));
const cacheApiMock = vi.hoisted(() => ({ putGlobal: vi.fn() }));
vi.mock('@/api/services/system/cache', async (orig) => ({
  ...(await orig<typeof import('@/api/services/system/cache')>()),
  cacheApi: cacheApiMock,
}));

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><SettingsCacheTab /></MemoryRouter></I18nextProvider>); }

describe('SettingsCacheTab — GlobalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheApiMock.putGlobal.mockResolvedValue({});
    apiState.global = ok({ normaliser_enabled: false, cache_master_kill_switch: false });
  });

  it('enabling the normaliser then saving puts the updated global config', async () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:settings.promptCache.globalTitle'))).toBeInTheDocument();
    const switches = screen.getAllByRole('switch'); // [0]=normaliser [1]=killSwitch
    fireEvent.click(switches[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
    await waitFor(() => expect(cacheApiMock.putGlobal).toHaveBeenCalledWith({ normaliser_enabled: true, cache_master_kill_switch: false }));
  });

  it('flipping the master kill switch is persisted on save', async () => {
    wrap();
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[1]); // kill switch
    fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
    await waitFor(() => expect(cacheApiMock.putGlobal).toHaveBeenCalledWith({ normaliser_enabled: false, cache_master_kill_switch: true }));
  });

  it('hydrates the toggles from the loaded config', () => {
    apiState.global = ok({ normaliser_enabled: true, cache_master_kill_switch: false });
    wrap();
    const switches = screen.getAllByRole('switch');
    expect(switches[0]).toBeChecked();
    expect(switches[1]).not.toBeChecked();
  });

  it('renders the error branch for the global config', () => {
    apiState.global = { data: undefined, loading: false, error: new Error('cache global boom'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('cache global boom')).toBeInTheDocument();
  });
});
