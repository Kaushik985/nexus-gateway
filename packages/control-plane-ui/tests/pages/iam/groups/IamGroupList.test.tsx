/**
 * IamGroupList — mocked-useApi list test: row render, row-click → detail nav,
 * loading/error. Replaces the render-without-crash smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamGroupList } from '@/pages/iam/groups/IamGroupList';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: vi.fn(), loading: false }) }));
vi.mock('@/api/services', () => ({ iamApi: { listGroups: vi.fn(), deleteGroup: vi.fn() } }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const group = { id: 'grp-1', name: 'Engineers', description: 'eng team' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamGroupList /></MemoryRouter></I18nextProvider>); }

describe('IamGroupList', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok({ data: [group], total: 1 }); });

  it('renders a group row (name + description)', () => {
    wrap();
    expect(screen.getByText('Engineers')).toBeInTheDocument();
    expect(screen.getByText('eng team')).toBeInTheDocument();
  });

  it('clicking a row opens the group detail', () => {
    wrap();
    fireEvent.click(screen.getByText('Engineers'));
    expect(navigate).toHaveBeenCalledWith('/iam/groups/grp-1');
  });

  it('renders the loading + error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('group list failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/group list failed/)).toBeInTheDocument();
  });
});
