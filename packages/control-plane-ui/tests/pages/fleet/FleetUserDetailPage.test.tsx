/**
 * FleetUserDetailPage — mocked-useApi user fixture: header (displayName/email),
 * loading/error branches. Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { FleetUserDetailPage } from '@/pages/fleet/FleetUserDetailPage';

vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useParams: () => ({ id: 'au-1' }), useNavigate: () => vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: vi.fn(), loading: false }) }));
vi.mock('@/api/services', () => ({ fleetApi: { getAgentUser: vi.fn(), listDevices: vi.fn(), getAgentUserAudit: vi.fn() } }));
const apiState = vi.hoisted(() => ({ user: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) => (key.some((k) => String(k).includes('detail') || String(k).includes('agent-user')) ? apiState.user : { data: undefined, loading: false, error: null, refetch: vi.fn() }),
}));

const user = { id: 'au-1', displayName: 'Jane Agent', email: 'jane@nexus.ai', status: 'active', createdAt: '2026-05-01T00:00:00Z' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><FleetUserDetailPage /></MemoryRouter></I18nextProvider>); }

describe('FleetUserDetailPage', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.user = ok(user); });

  it('renders the agent-user header by display name', () => {
    wrap();
    expect(screen.getAllByText('Jane Agent').length).toBeGreaterThan(0);
  });

  it('renders the loading + error branches', () => {
    apiState.user = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.user = { data: undefined, loading: false, error: new Error('agent user failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('agent user failed')).toBeInTheDocument();
  });
});
