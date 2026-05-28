/**
 * IamPrincipalPolicies — mocked-useApi attach list: attached-policy row render,
 * attach (Select mocked to native → iamApi.attachPrincipalPolicy), loading/error.
 * Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamPrincipalPolicies } from '@/pages/iam/policies/IamPrincipalPolicies';

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ type: 'user', id: 'u1' }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async (a: unknown) => { await fn(a); opts?.onSuccess?.(); }, loading: false,
  }),
}));
vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    ...actual,
    Select: ({ value, onValueChange, options }: { value?: string; onValueChange: (v: string) => void; options: Array<{ value: string; label: string }> }) => (
      <select aria-label="sel" value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}>
        <option value="">--</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});
const iam = vi.hoisted(() => ({ iamApi: { getPrincipalPolicies: vi.fn(), listPolicies: vi.fn(), attachPrincipalPolicy: vi.fn(), detachPrincipalPolicy: vi.fn() } }));
vi.mock('@/api/services', () => iam);
const apiState = vi.hoisted(() => ({ attachments: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() }, all: { data: { data: [] } as unknown } }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) => (key.some((k) => String(k).includes('all-policies') || String(k).includes('list')) ? apiState.all : apiState.attachments),
}));

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamPrincipalPolicies /></MemoryRouter></I18nextProvider>); }

describe('IamPrincipalPolicies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    iam.iamApi.attachPrincipalPolicy.mockResolvedValue({});
    apiState.attachments = ok({ data: [{ id: 'att-1', policyId: 'pol-1', policyName: 'AdminAccess', source: 'direct' }] });
    apiState.all = { data: { data: [{ id: 'pol-1', name: 'AdminAccess' }, { id: 'pol-2', name: 'ReadOnly' }] } };
  });

  it('renders an attached policy row', () => {
    wrap();
    expect(screen.getByText('AdminAccess')).toBeInTheDocument();
  });

  it('selecting an available policy + Attach calls attachPrincipalPolicy', async () => {
    wrap();
    // the policy select is the first native select (the available-policies one)
    fireEvent.change(screen.getAllByLabelText('sel')[0], { target: { value: 'pol-2' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.attachPolicy') }));
    await waitFor(() => expect(iam.iamApi.attachPrincipalPolicy).toHaveBeenCalledWith('user', 'u1', expect.objectContaining({ policyId: 'pol-2' })));
  });

  it('renders the loading + error branches', () => {
    apiState.attachments = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.attachments = { data: undefined, loading: false, error: new Error('attach list failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('attach list failed')).toBeInTheDocument();
  });
});
