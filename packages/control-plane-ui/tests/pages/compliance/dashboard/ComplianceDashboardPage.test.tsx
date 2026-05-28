/**
 * ComplianceDashboardPage — driven with a mocked useApi overview fixture so the
 * KPI row, top-blocked tab switching, CSV export and loading/error/empty
 * branches are asserted. Replaces the previous render-without-crashing smoke
 * test (test-for-test's-sake).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ComplianceDashboardPage } from '@/pages/compliance/dashboard/ComplianceDashboardPage';

const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
const download = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ api: { download } }));
vi.mock('@/api/services/compliance/compliance', () => ({
  complianceApi: {
    getOverview: vi.fn(),
    buildOverviewExportUrl: vi.fn(() => '/api/admin/proxy/compliance/export?x=1'),
  },
}));

const OVERVIEW = {
  kpis: { totalRequests: 4200, totalBlocked: 12, overallBlockRate: 0.003, tlsCoveragePercent: 97.5, hookErrorRate: 0.002 },
  trinity: { aiGateway: null, complianceProxy: null, agent: null },
  hookHealth: { total: 4200, byDecision: { allow: 4180, deny: 12, error: 0 }, latencyP95: 12, latencyP99: 30, topReasonCodes: [] },
  topBlocked: {
    byTarget: [{ label: 'api.bad.com', count: 8 }],
    byReasonCode: [{ label: 'PII', count: 5 }],
    bySourceIp: [{ label: '10.0.0.9', count: 3 }],
  },
};

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><ComplianceDashboardPage /></MemoryRouter></I18nextProvider>); }

describe('ComplianceDashboardPage', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok(OVERVIEW); });

  it('renders the KPI row from the overview data', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:proxy.compliance.kpiRequests', 'Total Requests'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:proxy.compliance.title', 'Compliance Overview'))).toBeInTheDocument();
  });

  it('switches the top-blocked table between target / reason / source-IP', () => {
    wrap();
    expect(screen.getByText('api.bad.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:proxy.compliance.topReasons', 'By Reason Code') }));
    expect(screen.getByText('PII')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:proxy.compliance.topSources', 'By Source IP') }));
    expect(screen.getByText('10.0.0.9')).toBeInTheDocument();
  });

  it('Export CSV downloads the built export URL', async () => {
    download.mockResolvedValue(undefined);
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:proxy.compliance.exportCsv', 'Export CSV') }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('/api/admin/proxy/compliance/export?x=1', undefined, 'compliance-events.csv'));
  });

  it('Refresh re-runs the overview query', () => {
    const refetch = vi.fn();
    apiState.value = { data: OVERVIEW, loading: false, error: null, refetch };
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:refresh', 'Refresh') }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the loading and error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { unmount } = wrap();
    expect(screen.queryByText(i18n.t('pages:proxy.compliance.kpiRequests', 'Total Requests'))).toBeNull();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('overview boom'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('overview boom')).toBeInTheDocument();
  });
});
