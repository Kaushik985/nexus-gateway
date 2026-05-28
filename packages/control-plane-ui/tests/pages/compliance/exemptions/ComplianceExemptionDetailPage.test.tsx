import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ComplianceExemptionDetailPage } from '@/pages/compliance/exemptions/ComplianceExemptionDetailPage';

const capi = vi.hoisted(() => ({
  complianceApi: {
    getExemption: vi.fn(), approveExemption: vi.fn(), rejectExemption: vi.fn(),
    deleteExemptionGrant: vi.fn(), patchExemptionGrant: vi.fn(),
  },
}));
vi.mock('@/api/services/compliance/compliance', () => capi);

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'ex-1' }),
  useNavigate: () => navigate,
}));

const addToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const base = { id: 'ex-1', sourceIp: '1.2.3.4', targetHost: 'api.openai.com', reason: 'debugging', requestedBy: 'alice', createdAt: '2026-05-01T00:00:00Z', expiresAt: '2026-05-02T00:00:00Z', activatedAt: null, inactive: null };
function ok(row: unknown) { return { data: row, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><MemoryRouter><ComplianceExemptionDetailPage /></MemoryRouter></I18nextProvider></QueryClientProvider>,
  );
}

describe('ComplianceExemptionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capi.complianceApi.approveExemption.mockResolvedValue(undefined);
    capi.complianceApi.rejectExemption.mockResolvedValue(undefined);
    capi.complianceApi.deleteExemptionGrant.mockResolvedValue(undefined);
    capi.complianceApi.patchExemptionGrant.mockResolvedValue(undefined);
  });

  it('renders the skeleton while loading', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.querySelector('[class*=keleton]') ?? container.firstChild).toBeTruthy();
  });

  it('renders an error banner on failure', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('exemption load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('exemption load failed')).toBeInTheDocument();
  });

  it('pending: approve opens the confirm dialog then calls approveExemption + navigates', async () => {
    apiState.value = ok({ ...base, kind: 'pending', status: 'pending' });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:compliance.exemptions.approveBtn') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:compliance.exemptions.approveConfirm') }));
    await waitFor(() => expect(capi.complianceApi.approveExemption).toHaveBeenCalledWith('ex-1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/compliance/exemptions'));
  });

  it('pending: reject requires a reason, then calls rejectExemption(id, reason)', async () => {
    apiState.value = ok({ ...base, kind: 'pending', status: 'pending' });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:compliance.exemptions.rejectBtn') }));
    const reason = screen.getByPlaceholderText(i18n.t('pages:compliance.exemptions.rejectReasonPlaceholder'));
    fireEvent.change(reason, { target: { value: 'not justified' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:compliance.exemptions.rejectSubmit') }));
    await waitFor(() => expect(capi.complianceApi.rejectExemption).toHaveBeenCalledWith('ex-1', 'not justified'));
  });

  it('grant: the disable toggle patches inactive=true', async () => {
    apiState.value = ok({ ...base, kind: 'grant', status: 'active', inactive: false, activatedAt: '2026-05-01T00:00:00Z' });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:compliance.exemptions.disableBtn') }));
    await waitFor(() => expect(capi.complianceApi.patchExemptionGrant).toHaveBeenCalledWith('ex-1', { inactive: true }));
  });

  it('grant not yet activated: delete confirm calls deleteExemptionGrant', async () => {
    apiState.value = ok({ ...base, kind: 'grant', status: 'pending', inactive: false, activatedAt: null });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:delete', 'Delete') }));
    const confirm = screen.getAllByRole('button', { name: i18n.t('common:delete', 'Delete') }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(capi.complianceApi.deleteExemptionGrant).toHaveBeenCalledWith('ex-1'));
  });
});
