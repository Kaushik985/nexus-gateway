import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { OrganizationDetail } from '@/pages/iam/organizations/OrganizationDetail';

const org = { id: 'o1', name: 'Acme', code: 'ACME', status: 'active', parentId: null, projectCount: 0, childCount: 0, createdAt: '2026-05-01T00:00:00Z' };
const orgApi = vi.hoisted(() => ({ organizationApi: { get: vi.fn(), update: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue({ data: [] }), tree: vi.fn().mockResolvedValue({ data: [] }) }, iamApi: { listUsers: vi.fn().mockResolvedValue({ data: [], total: 0 }) }, projectApi: { list: vi.fn().mockResolvedValue({ data: [] }) } }));
vi.mock('@/api/services', () => orgApi);
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useParams: () => ({ id: 'o1' }), useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
const mutateCalls = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({ mutate: async (a: unknown) => { mutateCalls.list.push(a); const r = await fn(a); opts?.onSuccess?.(r); return r; }, loading: false }) }));
const apiByKey = vi.hoisted(() => ({ org: undefined as unknown, members: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({ useApi: (_fn: unknown, key: unknown[]) => (key.includes('by-org') || key.includes('users') ? apiByKey.members : apiByKey.org) }));

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><OrganizationDetail /></MemoryRouter></I18nextProvider>); }

describe('OrganizationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateCalls.list = [];
    apiByKey.org = ok(org);
    apiByKey.members = ok({ data: [], total: 0 });
    orgApi.organizationApi.delete.mockResolvedValue({});
  });

  it('renders the org header', () => {
    wrap();
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('renders the error branch', () => {
    apiByKey.org = { data: undefined, loading: false, error: new Error('org load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('org load failed')).toBeInTheDocument();
  });

  it('Edit enters edit mode showing the name field', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:organizations.edit') }));
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
  });

  it('Delete confirm calls organizationApi.delete', async () => {
    wrap();
    // open the delete dialog then confirm; the confirm label is unique to the AlertDialog
    const delButtons = screen.getAllByRole('button').filter((b) => new RegExp(i18n.t('pages:organizations.delete'), 'i').test(b.textContent ?? ''));
    if (delButtons.length) fireEvent.click(delButtons[0]);
    const confirm = screen.getAllByRole('button', { name: i18n.t('pages:organizations.delete') }).at(-1);
    if (confirm) fireEvent.click(confirm);
    await waitFor(() => expect(orgApi.organizationApi.delete).toHaveBeenCalledWith('o1'));
  });

  it('editing the name then Save calls organizationApi.update with the new value', async () => {
    orgApi.organizationApi.update.mockResolvedValue({ ...org, name: 'Acme Renamed' });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:organizations.edit') }));
    fireEvent.change(screen.getByDisplayValue('Acme'), { target: { value: 'Acme Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:organizations.save') }));
    await waitFor(() => expect(orgApi.organizationApi.update).toHaveBeenCalledWith('o1', expect.objectContaining({ name: 'Acme Renamed', code: 'ACME' })));
  });
});
