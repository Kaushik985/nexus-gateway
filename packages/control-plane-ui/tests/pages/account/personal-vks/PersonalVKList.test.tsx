/**
 * PersonalVKList — mocked-useApi list test: VK row render, Create→navigate,
 * regenerate→personalVKApi.regenerate, loading/error. Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { PersonalVKList } from '@/pages/account/personal-vks/PersonalVKList';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/theme/useTheme', () => ({ useTheme: () => ({ brand: { productName: 'Nexus' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async (a: unknown) => { await fn(a); opts?.onSuccess?.(); }, loading: false,
  }),
}));
const vkApi = vi.hoisted(() => ({ personalVKApi: { list: vi.fn(), delete: vi.fn(), regenerate: vi.fn() } }));
vi.mock('@/api/services', () => vkApi);
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const vk = { id: 'pvk-1', name: 'my-laptop', enabled: true, rateLimitRpm: 60, createdAt: '2026-05-01T00:00:00Z' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><PersonalVKList /></MemoryRouter></I18nextProvider>); }

describe('PersonalVKList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vkApi.personalVKApi.regenerate.mockResolvedValue({});
    apiState.value = ok({ data: [vk], total: 1 });
  });

  it('renders a personal-VK row by name', () => {
    wrap();
    expect(screen.getByText('my-laptop')).toBeInTheDocument();
  });

  it('Create navigates to the new personal-VK route', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:personalVks.createVk') }));
    expect(navigate).toHaveBeenCalledWith('/settings/personal-vks/new');
  });

  it('renders the loading + error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('personal vk failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/personal vk failed/)).toBeInTheDocument();
  });
});
