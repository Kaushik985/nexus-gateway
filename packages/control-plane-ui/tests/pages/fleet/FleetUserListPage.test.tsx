/**
 * FleetUserListPage — mocked-useApi list test: agent-user row render,
 * row-click → detail nav, loading/error. Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { FleetUserListPage } from '@/pages/fleet/FleetUserListPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('@/api/services', () => ({ fleetApi: { listAgentUsers: vi.fn() } }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const user = { id: 'au-1', displayName: 'Jane Agent', email: 'jane@nexus.ai', status: 'active', createdAt: '2026-05-01T00:00:00Z' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><FleetUserListPage /></MemoryRouter></I18nextProvider>); }

describe('FleetUserListPage', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok({ data: [user], total: 1 }); });

  it('renders an agent-user row (name + email)', () => {
    wrap();
    expect(screen.getByText('Jane Agent')).toBeInTheDocument();
    expect(screen.getByText('jane@nexus.ai')).toBeInTheDocument();
  });

  it('clicking a row opens the fleet-user detail', () => {
    wrap();
    fireEvent.click(screen.getByText('Jane Agent'));
    expect(navigate).toHaveBeenCalledWith('/fleet/users/au-1');
  });

  it('renders the loading + error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('fleet users failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText(/fleet users failed/)).toBeInTheDocument();
  });
});
