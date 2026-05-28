import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamRoleDetail } from '@/pages/iam/roles/IamRoleDetail';

vi.mock('@/api/services', () => ({ iamApi: { getGroup: vi.fn(), listPolicies: vi.fn(), listUsers: vi.fn(), listGroupMembers: vi.fn(), addGroupMember: vi.fn(), removeGroupMember: vi.fn(), addGroupPolicy: vi.fn(), removeGroupPolicy: vi.fn(), updateGroup: vi.fn() } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useParams: () => ({ id: 'r1' }), useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({ mutate: async (a: unknown) => { const r = await fn(a); opts?.onSuccess?.(r); return r; }, loading: false }) }));
const apiByKey = vi.hoisted(() => ({ role: undefined as unknown, policies: undefined as unknown, users: undefined as unknown, members: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) =>
    key.includes('members') ? apiByKey.members
      : key.includes('users') ? apiByKey.users
      : key.includes('policies') && !key.includes('detail') ? apiByKey.policies
      : apiByKey.role,
}));

const role = { id: 'r1', name: 'Admins', description: 'admin role', createdAt: '2026-05-01T00:00:00Z', policyAttachments: [{ id: 'att1', policyId: 'p1', policy: { name: 'ReadAll' } }] };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamRoleDetail /></MemoryRouter></I18nextProvider>); }

describe('IamRoleDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.role = ok(role);
    apiByKey.policies = ok({ data: [{ id: 'p2', name: 'WriteAll' }] });
    apiByKey.users = ok({ data: [{ id: 'u1', displayName: 'Alice' }] });
    apiByKey.members = ok({ data: [{ id: 'm1', principalType: 'api_key', principalId: 'k1', createdAt: '2026-05-01T00:00:00Z' }], total: 1 });
  });

  it('renders the role header', () => {
    wrap();
    expect(screen.getAllByText('Admins').length).toBeGreaterThan(0);
  });

  it('renders the error branch', () => {
    apiByKey.role = { data: undefined, loading: false, error: new Error('role load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('role load failed')).toBeInTheDocument();
  });

  it('Members tab lists the member principal', async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('pages:iam.members'), 'i') }));
    await waitFor(() => expect(screen.getByText('k1')).toBeInTheDocument());
  });

  it('Policies tab lists the attached policy', async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('pages:iam.attachedPolicies'), 'i') }));
    await waitFor(() => expect(screen.getByText('ReadAll')).toBeInTheDocument());
  });
});
