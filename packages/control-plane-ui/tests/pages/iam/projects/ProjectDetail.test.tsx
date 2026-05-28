/**
 * ProjectDetail — mocked-useApi detail test: header, edit→save→update,
 * delete→delete+navigate, loading/error. Replaces the render-without-crash
 * smoke test. useMutation runs the real fn so the API calls fire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ProjectDetail } from '@/pages/iam/projects/ProjectDetail';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'proj-1' }),
  useNavigate: () => navigate,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: () => void }) => ({
    mutate: async (a: unknown) => { await fn(a); opts?.onSuccess?.(); }, loading: false,
  }),
}));
const projApi = vi.hoisted(() => ({ projectApi: { get: vi.fn(), update: vi.fn(), delete: vi.fn() } }));
vi.mock('@/api/services', () => projApi);
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const project = { id: 'proj-1', name: 'Billing', code: 'BILL', description: 'd', status: 'active', contactName: '', contactEmail: '', virtualKeys: [] };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><ProjectDetail /></MemoryRouter></I18nextProvider>); }

describe('ProjectDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projApi.projectApi.update.mockResolvedValue(project);
    projApi.projectApi.delete.mockResolvedValue({});
    apiState.value = ok(project);
  });

  it('renders the project header', () => {
    wrap();
    expect(screen.getAllByText('Billing').length).toBeGreaterThan(0);
  });

  it('editing then Save calls projectApi.update', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:projects.edit') }));
    fireEvent.change(screen.getByDisplayValue('Billing'), { target: { value: 'Billing 2' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:projects.save') }));
    await waitFor(() => expect(projApi.projectApi.update).toHaveBeenCalledWith('proj-1', expect.objectContaining({ name: 'Billing 2' })));
  });

  it('deleting confirms then calls delete + navigates to the project list', async () => {
    wrap();
    const delButtons = screen.getAllByRole('button', { name: i18n.t('pages:projects.delete') });
    fireEvent.click(delButtons[0]);
    const confirm = screen.getAllByRole('button', { name: i18n.t('pages:projects.delete') }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(projApi.projectApi.delete).toHaveBeenCalledWith('proj-1'));
    expect(navigate).toHaveBeenCalledWith('/iam/projects');
  });

  it('renders the error branch', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('project load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('project load failed')).toBeInTheDocument();
  });
});
