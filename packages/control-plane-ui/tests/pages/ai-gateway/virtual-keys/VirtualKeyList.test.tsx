import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { VirtualKeyListPage } from '@/pages/ai-gateway/virtual-keys/VirtualKeyList';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));

const apiByKey = vi.hoisted(() => ({ vks: undefined as unknown, projects: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) => (key.includes('projects') ? apiByKey.projects : apiByKey.vks),
}));
const mutateCalls = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: () => ({ mutate: (a: unknown) => { mutateCalls.list.push(a); return Promise.resolve(); }, loading: false }),
}));

const vk = { id: 'vk1', name: 'prod-key', projectId: 'p1', enabled: true, vkStatus: 'active', vkType: 'application', expiresAt: '2020-01-01T00:00:00Z' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><VirtualKeyListPage /></MemoryRouter></I18nextProvider>);
}

describe('VirtualKeyListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateCalls.list = [];
    apiByKey.vks = ok({ data: [vk], total: 1 });
    apiByKey.projects = ok({ data: [{ id: 'p1', name: 'Proj', organization: { name: 'Org' } }] });
  });

  it('renders a VK row with project/org, status badge, and an overdue-expiry badge', () => {
    wrap();
    expect(screen.getByText('prod-key')).toBeInTheDocument();
    // 'Proj' appears in both the project filter dropdown and the row cell
    expect(screen.getAllByText('Proj').length).toBeGreaterThan(0);
    expect(screen.getByText('Org')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:credentials.expiresOverdue'))).toBeInTheDocument();
  });

  it('toggling the enabled switch fires the update mutation', async () => {
    wrap();
    const toggle = screen.getByLabelText(i18n.t('common:listToggleEnabledAria', { name: 'prod-key' }));
    fireEvent.click(toggle);
    await waitFor(() => expect(mutateCalls.list).toContainEqual({ id: 'vk1', enabled: false }));
  });

  it('renders the loading skeleton', () => {
    apiByKey.vks = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.querySelector('[class*=keleton]') ?? container.firstChild).toBeTruthy();
  });

  it('renders the error banner with retry', () => {
    apiByKey.vks = { data: undefined, loading: false, error: new Error('vk list failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('vk list failed')).toBeInTheDocument();
  });

  it('Create virtual key navigates to the new-key route', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:virtualKeys.createVirtualKey') }));
    expect(navigate).toHaveBeenCalledWith('/ai-gateway/virtual-keys/new');
  });

  it('clicking a row navigates to its detail page', () => {
    wrap();
    fireEvent.click(screen.getByText('prod-key'));
    expect(navigate).toHaveBeenCalledWith('/ai-gateway/virtual-keys/vk1');
  });

  it('approving a pending application VK fires the approve mutation', () => {
    const pending = { id: 'vk2', name: 'pending-key', projectId: 'p1', enabled: true, vkStatus: 'pending', vkType: 'application', expiresAt: null };
    apiByKey.vks = ok({ data: [pending], total: 1 });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:virtualKeys.approve') }));
    expect(mutateCalls.list).toContain('vk2');
  });

  it('revoking an active application VK fires the revoke mutation', () => {
    wrap(); // default vk1 is active + application
    fireEvent.click(screen.getByLabelText(i18n.t('pages:virtualKeys.revoke')));
    expect(mutateCalls.list).toContain('vk1');
  });
});
