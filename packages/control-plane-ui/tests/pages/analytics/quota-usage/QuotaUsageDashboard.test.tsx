/**
 * QuotaUsageDashboard — mocked-useApi overview + top fixtures: title + an
 * overview row, loading/error. Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { QuotaUsageDashboard } from '@/pages/analytics/quota-usage/QuotaUsageDashboard';

const apiState = vi.hoisted(() => ({ overview: { data: undefined as unknown, loading: false, error: null as Error | null }, top: { data: { data: [] } as unknown, loading: false, error: null } }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) => (key.some((k) => String(k).includes('top')) ? apiState.top : apiState.overview),
}));
vi.mock('@/api/services/ai-gateway/quotaAnalytics', () => ({ quotaAnalyticsApi: { overview: vi.fn(), topConsumers: vi.fn() } }));

const row = { entityName: 'org-acme', entityType: 'organization', costLimitUsd: 100, currentCostUsd: 50, usagePercent: 50, alertLevel: 'ok' };
function ok(d: unknown) { return { data: d, loading: false, error: null }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><QuotaUsageDashboard /></MemoryRouter></I18nextProvider>); }

describe('QuotaUsageDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.overview = ok({ data: [row] });
    apiState.top = ok({ data: [] });
  });

  it('renders the title + an overview row', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:quotaUsage.title'))).toBeInTheDocument();
    expect(screen.getByText('org-acme')).toBeInTheDocument();
  });

  it('renders the error branch', () => {
    apiState.overview = { data: undefined, loading: false, error: new Error('quota usage failed') };
    wrap();
    expect(screen.getByText(/quota usage failed/)).toBeInTheDocument();
  });
});
