import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { AuditLogPage } from '@/pages/governance/AuditLogPage';

const svc = vi.hoisted(() => ({
  systemApi: { listAdminAuditLogs: vi.fn(), exportAdminAuditLogs: vi.fn() },
  iamApi: { listUsers: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('@/api/services', () => svc);
const addToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' }, isAuthenticated: true, permissions: ['*'] }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const entries = [{ id: 'a1', actorLabel: 'alice', entityType: 'Provider', entityId: 'p1', action: 'provider.update', timestamp: '2026-05-28T00:00:00Z' }];
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><AuditLogPage /></MemoryRouter></I18nextProvider>);
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = ok({ data: entries, total: 1 });
    svc.systemApi.exportAdminAuditLogs.mockResolvedValue({ data: entries, truncated: false });
    if (!URL.createObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:x') });
    if (!URL.revokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('renders the audit table with an entry action', () => {
    wrap();
    expect(screen.getByText('provider.update')).toBeInTheDocument();
  });

  it('renders the loading spinner', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the error branch', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('audit load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/audit load failed/)).toBeInTheDocument();
  });

  it('Export pulls the audit rows via exportAdminAuditLogs', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:audit.export') }));
    await waitFor(() => expect(svc.systemApi.exportAdminAuditLogs).toHaveBeenCalled());
  });
});
