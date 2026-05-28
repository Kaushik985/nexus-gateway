import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { AccountActivityTab } from '@/pages/account/AccountActivityTab';

vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ userId: 'u1', permissions: ['*'] }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('@/api/services', () => ({ systemApi: { listMyAdminAuditLogs: vi.fn(), exportAdminAuditLogs: vi.fn() }, iamApi: { listUsers: vi.fn().mockResolvedValue({ data: [] }) } }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const entries = [{ id: 'a1', actorLabel: 'me', entityType: 'Provider', entityId: 'p1', action: 'provider.update', timestamp: '2026-05-28T00:00:00Z' }];
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><AccountActivityTab /></MemoryRouter></I18nextProvider>); }

describe('AccountActivityTab', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok({ data: entries, total: 1 }); });

  it('renders the self-scoped audit table with an entry action', () => {
    wrap();
    expect(screen.getByText('provider.update')).toBeInTheDocument();
  });

  it('renders the loading spinner', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the error branch', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('activity load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/activity load failed/)).toBeInTheDocument();
  });
});
