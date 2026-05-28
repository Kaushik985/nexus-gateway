/**
 * IamRoleList — mocked-useApi list test: row render, row-click → detail nav,
 * loading/error. Replaces the render-without-crash smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamRoleList } from '@/pages/iam/roles/IamRoleList';

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

const role = { id: 'role-1', name: 'Admin', description: 'admin role' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamRoleList /></MemoryRouter></I18nextProvider>); }

describe('IamRoleList', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok({ data: [role], total: 1 }); });

  it('renders a role row (name + description)', () => {
    wrap();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('admin role')).toBeInTheDocument();
  });

  it('clicking a row opens the role detail', () => {
    wrap();
    fireEvent.click(screen.getByText('Admin'));
    expect(navigate).toHaveBeenCalledWith('/iam/roles/role-1');
  });

  it('renders the loading + error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('role list failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/role list failed/)).toBeInTheDocument();
  });
});
