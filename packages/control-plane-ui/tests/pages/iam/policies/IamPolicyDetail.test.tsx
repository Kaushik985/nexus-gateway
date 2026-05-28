import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamPolicyDetail } from '@/pages/iam/policies/IamPolicyDetail';

vi.mock('@/api/services', () => ({ iamApi: { getPolicy: vi.fn(), getPolicyAttachments: vi.fn(), listUsers: vi.fn() } }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useParams: () => ({ id: 'p1' }), useNavigate: () => vi.fn() }));
const apiByKey = vi.hoisted(() => ({ policy: undefined as unknown, attach: undefined as unknown, users: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) => (key.includes('attachments') ? apiByKey.attach : key.includes('users') ? apiByKey.users : apiByKey.policy),
}));

const policy = { id: 'p1', name: 'ReadAll', description: 'read-only', document: { Version: '2025-01-01', Statement: [{ Sid: 's1', Effect: 'Allow', Action: ['admin:provider.read'], Resource: ['nrn:nexus:gateway:*:provider/*'] }] } };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamPolicyDetail /></MemoryRouter></I18nextProvider>); }

describe('IamPolicyDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.policy = ok(policy);
    apiByKey.attach = ok({ roles: [], directAttachments: [] });
    apiByKey.users = ok({ data: [] });
  });

  it('renders the policy header', () => {
    wrap();
    expect(screen.getAllByText('ReadAll').length).toBeGreaterThan(0);
  });

  it('renders the error branch', () => {
    apiByKey.policy = { data: undefined, loading: false, error: new Error('policy load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('policy load failed')).toBeInTheDocument();
  });

  it('switching to the Statements tab shows the statement action', () => {
    wrap();
    fireEvent.click(screen.getByText(new RegExp(`${i18n.t('pages:iam.statements')} \\(1\\)`)));
    expect(screen.getByText('admin:provider.read')).toBeInTheDocument();
  });
});
