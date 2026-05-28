/**
 * FleetOverviewPage — mocked-useApi summary fixture: KPI cards + title,
 * loading/error. Replaces the smoke test. Uses renderWithRouter (full
 * providers) because the page reads useTheme for chart colours.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '@/i18n';
import { renderWithRouter } from '@/test/test-utils';
import { FleetOverviewPage } from '@/pages/fleet-analytics/FleetOverviewPage';

const apiState = vi.hoisted(() => ({ summary: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) =>
    key.some((k) => String(k).includes('summary')) ? apiState.summary : { data: undefined, loading: false, error: null, refetch: vi.fn() },
}));

const summary = { total: 50, active: 40, stale: 6, critical: 3, revoked: 1, stalePct: 12, criticalPct: 6 };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }

describe('FleetOverviewPage', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.summary = ok(summary); });

  it('renders the title + KPI cards from the summary', () => {
    renderWithRouter(<FleetOverviewPage />);
    expect(screen.getByText(i18n.t('pages:fleetOverview.title'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:fleetOverview.kpiTotal'))).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument(); // total devices
  });

  it('renders the loading branch', () => {
    apiState.summary = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = renderWithRouter(<FleetOverviewPage />);
    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText(i18n.t('pages:fleetOverview.kpiTotal'))).toBeNull();
  });

  it('renders the error branch', () => {
    apiState.summary = { data: undefined, loading: false, error: new Error('fleet summary failed'), refetch: vi.fn() };
    renderWithRouter(<FleetOverviewPage />);
    expect(screen.getByText('fleet summary failed')).toBeInTheDocument();
  });
});
