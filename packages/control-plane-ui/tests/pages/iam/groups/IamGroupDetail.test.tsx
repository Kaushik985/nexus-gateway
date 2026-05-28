import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamGroupDetail } from '@/pages/iam/groups/IamGroupDetail';

const iam = vi.hoisted(() => ({
  iamApi: {
    getGroup: vi.fn(), listPolicies: vi.fn(), listGroupMembers: vi.fn(),
    addGroupMember: vi.fn(), removeGroupMember: vi.fn(), addGroupPolicy: vi.fn(), removeGroupPolicy: vi.fn(),
  },
}));
vi.mock('@/api/services', () => iam);
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useParams: () => ({ id: 'g1' }), useNavigate: () => vi.fn() }));
const mutateCalls = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { mutateCalls.list.push(arg); const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));
const apiByKey = vi.hoisted(() => ({ group: undefined as unknown, policies: undefined as unknown, members: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) =>
    key.includes('members') ? apiByKey.members
      : key.includes('policies') && !key.includes('detail') ? apiByKey.policies
      : apiByKey.group,
}));

const group = { id: 'g1', name: 'Admins', description: 'admin group', createdAt: '2026-05-01T00:00:00Z', policyAttachments: [{ id: 'att1', policyId: 'p1', policy: { name: 'ReadAll' } }] };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamGroupDetail /></MemoryRouter></I18nextProvider>);
}

describe('IamGroupDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateCalls.list = [];
    apiByKey.group = ok(group);
    apiByKey.policies = ok({ data: [{ id: 'p2', name: 'WriteAll' }] });
    apiByKey.members = ok({ data: [{ id: 'm1', principalType: 'api_key', principalId: 'k1', createdAt: '2026-05-01T00:00:00Z' }], total: 1 });
  });

  it('renders the group header + info tab counts', () => {
    wrap();
    expect(screen.getAllByText('Admins').length).toBeGreaterThan(0);
    // tab labels carry the member + policy counts (both "(1)")
    expect(screen.getAllByText(/\(1\)/).length).toBeGreaterThan(0);
  });

  it('renders the error branch', () => {
    apiByKey.group = { data: undefined, loading: false, error: new Error('group load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('group load failed')).toBeInTheDocument();
  });

  it('switching to the Members tab lists the member principal', async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('pages:iam.members'), 'i') }));
    await waitFor(() => expect(screen.getByText('k1')).toBeInTheDocument());
  });

  it('switching to the Policies tab lists the attached policy', async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('pages:iam.attachedPolicies'), 'i') }));
    await waitFor(() => expect(screen.getByText('ReadAll')).toBeInTheDocument());
  });
});
