/**
 * ComplianceReportPage — the report is generated on demand: clicking Generate
 * calls complianceReportApi.get and renders the coverage/hook-health summary; a
 * failed generate surfaces the error banner. Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ComplianceReportPage } from '@/pages/governance/ComplianceReportPage';

const reportApi = vi.hoisted(() => ({ complianceReportApi: { get: vi.fn() } }));
vi.mock('@/api/services/compliance/compliance-report', () => reportApi);

const report = {
  period: { start: '2026-05-01T00:00:00Z', end: '2026-05-31T00:00:00Z' },
  generatedAt: '2026-05-31T01:00:00Z',
  coverage: { totalEvents: 1000, coveragePercent: 95.5, breakdown: {} },
  hookHealth: { total: 500, byDecision: { allow: 480, deny: 20, error: 0, unknown: 0 }, topDenyReasons: [], latencyP95: 10, latencyP99: 25 },
  dsar: { completed: 5, completedInPeriod: 2, inProgress: 1, pending: 0, rejected: 0 },
  rejectStats: { totalRejects: 20, topTargets: [] },
};
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><ComplianceReportPage /></MemoryRouter></I18nextProvider>); }

describe('ComplianceReportPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('generating a report calls the API and renders the coverage summary', async () => {
    reportApi.complianceReportApi.get.mockResolvedValue(report);
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:security.complianceReport.generate', 'Generate') }));
    await waitFor(() => expect(reportApi.complianceReportApi.get).toHaveBeenCalled());
    expect(await screen.findByText(/95\.50%/)).toBeInTheDocument();
  });

  it('a failed generate surfaces the error banner', async () => {
    reportApi.complianceReportApi.get.mockRejectedValue(new Error('report gen failed'));
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:security.complianceReport.generate', 'Generate') }));
    expect(await screen.findByText('report gen failed')).toBeInTheDocument();
  });
});
