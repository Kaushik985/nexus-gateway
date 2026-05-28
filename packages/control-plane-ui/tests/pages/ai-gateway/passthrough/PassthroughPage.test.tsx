import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { PassthroughPage } from '@/pages/ai-gateway/passthrough/PassthroughPage';
import { passthroughApi } from '@/api/services';

// partial mock — keep real helpers (validatePassthroughPayload etc.), stub the API object
vi.mock('@/api/services', async (orig) => ({ ...(await orig<typeof import('@/api/services')>()), passthroughApi: { getSnapshot: vi.fn(), putGlobal: vi.fn(), putAdapter: vi.fn(), putProvider: vi.fn(), deleteAdapter: vi.fn(), deleteProvider: vi.fn() } }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
// run the real mutation fn + onSuccess so putGlobal / onSave are exercised
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: () => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async () => { await fn(); opts?.onSuccess?.(); },
    loading: false,
  }),
}));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const tier = (enabled: boolean) => ({ enabled, bypassHooks: enabled, bypassCache: false, bypassNormalize: false, expiresAt: null, reason: '' });
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><PassthroughPage /></MemoryRouter></I18nextProvider>); }

describe('PassthroughPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the inactive banner when no tier is enabled', () => {
    apiState.value = ok({ global: tier(false), adapters: {}, providers: {} });
    wrap();
    expect(screen.getByText(i18n.t('pages:passthrough.banner.inactiveTitle'))).toBeInTheDocument();
  });

  it('shows the active banner counting enabled tiers', () => {
    apiState.value = ok({ global: tier(true), adapters: { openai: tier(true) }, providers: { 'prov-1': tier(false) } });
    wrap();
    expect(screen.getByText(i18n.t('pages:passthrough.banner.activeTitle', { count: 2 }))).toBeInTheDocument();
  });

  it('renders the loading skeleton', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the error branch', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('passthrough load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('passthrough load failed')).toBeInTheDocument();
  });

  it('saving a disabled global tier puts the disabled payload directly (no confirm)', async () => {
    apiState.value = ok({ global: tier(false), adapters: {}, providers: {} });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:passthrough.global.saveDisableBtn') }));
    await waitFor(() => expect(passthroughApi.putGlobal).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
    // no confirm dialog for the disable path
    expect(screen.queryByRole('button', { name: i18n.t('pages:passthrough.confirm.confirmBtn') })).toBeNull();
  });

  it('enabling the global tier requires confirmation before putGlobal fires', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h, valid window
    apiState.value = ok({ global: { enabled: true, bypassHooks: true, bypassCache: false, bypassNormalize: false, expiresAt, reason: 'active incident response' }, adapters: {}, providers: {} });
    wrap();
    // enabled tier → danger save button opens the confirm dialog instead of saving
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:passthrough.global.saveEnableBtn') }));
    expect(passthroughApi.putGlobal).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: i18n.t('pages:passthrough.confirm.confirmBtn') });
    fireEvent.click(confirm);
    await waitFor(() => expect(passthroughApi.putGlobal).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, bypassHooks: true })));
  });

  it('deleting an adapter override calls deleteAdapter after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    apiState.value = ok({ global: tier(false), adapters: { openai: tier(true) }, providers: {} });
    wrap();
    expect(screen.getAllByText('openai').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('common:delete') })[0]);
    await waitFor(() => expect(passthroughApi.deleteAdapter).toHaveBeenCalledWith('openai'));
  });

  it('a cancelled confirm does NOT delete the adapter', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    apiState.value = ok({ global: tier(false), adapters: { openai: tier(true) }, providers: {} });
    wrap();
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('common:delete') })[0]);
    expect(passthroughApi.deleteAdapter).not.toHaveBeenCalled();
  });

  it('deleting a provider override calls deleteProvider after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    apiState.value = ok({ global: tier(false), adapters: {}, providers: { 'prov-1': tier(true) } });
    wrap();
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('common:delete') })[0]);
    await waitFor(() => expect(passthroughApi.deleteProvider).toHaveBeenCalledWith('prov-1'));
  });
});
