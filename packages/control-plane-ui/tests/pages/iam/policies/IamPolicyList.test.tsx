/**
 * IamPolicyList — list page driven with a mocked useApi fixture: asserts the
 * policy row renders, Create navigates, a row click opens detail, and the
 * loading/error branches. Replaces the render-without-crash smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamPolicyList } from '@/pages/iam/policies/IamPolicyList';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: vi.fn(), loading: false }) }));
vi.mock('@/api/services', () => ({ iamApi: { listPolicies: vi.fn(), deletePolicy: vi.fn() } }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const policy = { id: 'pol-1', name: 'ReadOnly', type: 'custom', description: 'read access', enabled: true, document: { Statement: [{}] } };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamPolicyList /></MemoryRouter></I18nextProvider>); }

describe('IamPolicyList', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok({ data: [policy], total: 1 }); });

  it('renders a policy row (name + description)', () => {
    wrap();
    expect(screen.getByText('ReadOnly')).toBeInTheDocument();
    expect(screen.getByText('read access')).toBeInTheDocument();
  });

  it('Create policy navigates to the new-policy route', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.createPolicy') }));
    expect(navigate).toHaveBeenCalledWith('/iam/policies/new');
  });

  it('clicking a row opens the policy detail', () => {
    wrap();
    fireEvent.click(screen.getByText('ReadOnly'));
    expect(navigate).toHaveBeenCalledWith('/iam/policies/pol-1');
  });

  it('renders the loading + error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('policy list failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/policy list failed/)).toBeInTheDocument();
  });
});
