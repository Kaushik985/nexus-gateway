import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { QuotaOverrideListPage } from '@/pages/ai-gateway/quota-overrides/QuotaOverrideList';

const override = { id: 'o1', targetType: 'vk', targetId: 't1', targetName: 'my-key', reason: 'pilot', costLimitUsd: 50, enforcementMode: 'hard', periodType: 'monthly', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
vi.mock('@/api/services', () => ({ quotaOverrideApi: { list: vi.fn() }, iamApi: { listUsers: vi.fn() }, virtualKeyApi: { list: vi.fn() }, projectApi: { list: vi.fn() }, organizationApi: { list: vi.fn() } }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: vi.fn(), loading: false }) }));

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><QuotaOverrideListPage /></MemoryRouter></I18nextProvider>); }

describe('QuotaOverrideListPage', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok({ data: [override], total: 1 }); });

  it('renders an override row with its target + cost', () => {
    wrap();
    expect(screen.getByText('my-key')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
  });

  it('Create navigates to the new-override route', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:quotaOverrides.createOverride') }));
    expect(navigate).toHaveBeenCalledWith('/ai-gateway/quota-overrides/new');
  });

  it('clicking a row navigates to its detail page', () => {
    wrap();
    fireEvent.click(screen.getByText('my-key'));
    expect(navigate).toHaveBeenCalledWith('/ai-gateway/quota-overrides/o1');
  });

  it('renders the loading + error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
    apiState.value = { data: undefined, loading: false, error: new Error('quota list failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('quota list failed')).toBeInTheDocument();
  });
});
