import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamUsersWithOrgsPage } from '@/pages/iam/users/IamUsersWithOrgsPage';

vi.mock('@/api/services', () => ({ iamApi: { listUsers: vi.fn(), listOrganizations: vi.fn() } }));
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
const apiByKey = vi.hoisted(() => ({ users: undefined as unknown, orgs: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({ useApi: (_fn: unknown, key: unknown[]) => (key.includes('users') ? apiByKey.users : apiByKey.orgs) }));

const user = { id: 'u1', displayName: 'Alice', email: 'alice@nexus.ai', organizationId: 'o1', organizationName: 'Acme', status: 'active', consoleAccess: 'enabled' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamUsersWithOrgsPage /></MemoryRouter></I18nextProvider>);
}

describe('IamUsersWithOrgsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.users = ok({ data: [user], total: 1 });
    apiByKey.orgs = ok({ data: [{ id: 'o1', name: 'Acme' }] });
  });

  it('renders a user row (name + email)', () => {
    wrap();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@nexus.ai')).toBeInTheDocument();
  });

  it('Create user navigates to the new-user route', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.createUser') }));
    expect(navigate).toHaveBeenCalledWith('/iam/users/new');
  });

  it('clicking a user row navigates to its detail page', () => {
    wrap();
    fireEvent.click(screen.getByText('alice@nexus.ai'));
    expect(navigate).toHaveBeenCalledWith('/iam/users/u1');
  });

  it('renders the loading + error branches', () => {
    apiByKey.users = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
    apiByKey.users = { data: undefined, loading: false, error: new Error('users load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/users load failed/)).toBeInTheDocument();
  });
});
