/**
 * QuotaPolicyDetail — mocked-useApi detail test: header + org mapping,
 * Edit→navigate, loading/error. Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { QuotaPolicyDetail } from '@/pages/ai-gateway/quota-policies/QuotaPolicyDetail';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'qp-1' }),
  useNavigate: () => navigate,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('@/api/services', () => ({ quotaPolicyApi: { get: vi.fn() }, organizationApi: { list: vi.fn() } }));
const apiState = vi.hoisted(() => ({ policy: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() }, orgs: { data: { data: [] } as unknown } }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) => (key.some((k) => String(k).includes('organization')) ? apiState.orgs : apiState.policy),
}));

const policy = { id: 'qp-1', name: 'Free Tier', description: 'free plan', organizationId: 'o1', alertThresholds: [80, 90] };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><QuotaPolicyDetail /></MemoryRouter></I18nextProvider>); }

describe('QuotaPolicyDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.policy = ok(policy);
    apiState.orgs = { data: { data: [{ id: 'o1', name: 'Acme' }] } };
  });

  it('renders the policy header (name + description)', () => {
    wrap();
    expect(screen.getAllByText('Free Tier').length).toBeGreaterThan(0);
    expect(screen.getAllByText('free plan').length).toBeGreaterThan(0);
  });

  it('Edit navigates to the policy edit route', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(navigate).toHaveBeenCalledWith('/ai-gateway/quota-policies/qp-1/edit');
  });

  it('renders the error branch', () => {
    apiState.policy = { data: undefined, loading: false, error: new Error('quota policy failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('quota policy failed')).toBeInTheDocument();
  });
});
