/**
 * CacheROIDashboard — mocked-useApi ROI fixture: title + per-adapter row,
 * time-range buttons, empty-data + loading/error branches. Replaces the smoke
 * test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';
import { renderWithRouter } from '@/test/test-utils';
import { CacheROIDashboard } from '@/pages/analytics/CacheROIDashboard';

vi.mock('@/api/services/overview/analytics', () => ({ analyticsApi: { cacheROI: vi.fn(), triggerCacheRollup: vi.fn() } }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const adapter = {
  adapter: 'anthropic', gatewayCacheHitCount: 10, gatewayCacheSavingsUsd: 0.5, requestsWithCacheHit: 8,
  cacheWriteCostUsd: 0.1, cacheReadSavingsUsd: 0.4, cacheCreationTokens: 100, cacheReadTokens: 400,
  estimatedCostUsd: 2, cacheNetSavingsUsd: 0.3,
};
const ROI = {
  since: new Date().toISOString(), until: new Date().toISOString(), periodDays: 30,
  totalEstimatedCostUsd: 2, totalGatewayCacheSavingsUsd: 0.5, gatewayCacheHitCount: 10,
  totalCacheWriteCostUsd: 0.1, totalCacheReadSavingsUsd: 0.4, totalCacheNetSavingsUsd: 0.3,
  totalPromptTokens: 1000, totalCompletionTokens: 500, totalCacheCreationTokens: 100, totalCacheReadTokens: 400,
  totalNormalisedStripCount: 0, totalNormalisedStripBytes: 0, totalMarkersInjected: 0, requestsWithCacheHit: 8,
  byAdapter: [adapter], daily: [], dataSource: 'rollup',
};
const EMPTY = { ...ROI, byAdapter: [], totalGatewayCacheSavingsUsd: 0, totalCacheNetSavingsUsd: 0, gatewayCacheHitCount: 0, requestsWithCacheHit: 0 };

function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return renderWithRouter(<CacheROIDashboard />); }

describe('CacheROIDashboard', () => {
  beforeEach(() => { vi.clearAllMocks(); apiState.value = ok(ROI); });

  it('renders the title + the per-adapter ROI row', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:analytics.cacheRoi.title'))).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
  });

  it('the time-range buttons reflect the selected window', () => {
    wrap();
    const btn90 = screen.getByRole('button', { name: '90d' });
    fireEvent.click(btn90);
    expect(btn90).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the no-data state when there is no cache activity', () => {
    apiState.value = ok(EMPTY);
    wrap();
    expect(screen.getByText(i18n.t('pages:analytics.cacheRoi.noData'))).toBeInTheDocument();
  });

  it('renders the loading + error branches', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container, unmount } = wrap();
    expect(container.firstChild).toBeTruthy();
    unmount();
    apiState.value = { data: undefined, loading: false, error: new Error('roi failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('roi failed')).toBeInTheDocument();
  });
});
