import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ProviderCacheTab } from '@/pages/ai-gateway/providers/detail/ProviderCacheTab';

const cache = vi.hoisted(() => ({ cacheApi: { getEffective: vi.fn(), getProvider: vi.fn(), putProvider: vi.fn() } }));
// keep the real familyOf (adapter → anthropic/gemini/none), stub the cacheApi.
vi.mock('@/api/services/system/cache', async (orig) => ({ ...(await orig<typeof import('@/api/services/system/cache')>()), cacheApi: cache.cacheApi }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));
const apiByKey = vi.hoisted(() => ({ eff: undefined as unknown, override: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) => (key.includes('effective') ? apiByKey.eff : apiByKey.override),
}));

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap(adapterType: string) {
  return render(<I18nextProvider i18n={i18n}><ProviderCacheTab providerID="p1" adapterType={adapterType} /></I18nextProvider>);
}

describe('ProviderCacheTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.eff = ok({ effective: {}, sources: {} });
    apiByKey.override = ok({});
    cache.cacheApi.putProvider.mockResolvedValue({});
  });

  it('shows the provider-managed info card for a non-tunable adapter family', () => {
    wrap('openai');
    expect(screen.getByText(i18n.t('pages:providers.cacheAutoTitle'))).toBeInTheDocument();
  });

  it('renders the editor skeleton while the effective config loads', () => {
    apiByKey.eff = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap('anthropic');
    expect(container.firstChild).toBeTruthy();
  });

  it('an Anthropic provider renders the override editor + Save persists the buffer', async () => {
    wrap('anthropic');
    expect(screen.getByText(i18n.t('pages:providers.cacheTitle'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(cache.cacheApi.putProvider).toHaveBeenCalledWith('p1', {}));
  });
});
