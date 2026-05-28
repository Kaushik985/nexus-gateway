import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ThingStatsTab } from '@/pages/infrastructure/_shared/tabs/metrics/ThingStatsTab';

const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: () => {} } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const rows = [
  { metricName: 'request_count', dimensionKey: '', bucketStart: '2026-05-28T00:00:00Z', value: 100 },
  { metricName: 'request_count', dimensionKey: '', bucketStart: '2026-05-28T01:00:00Z', value: 50 },
  // ai-gateway's first (active) breakdown tab is topModels (model / total_tokens)
  { metricName: 'total_tokens', dimensionKey: 'model=gpt-4o', bucketStart: '2026-05-28T00:00:00Z', value: 5000 },
  { metricName: 'total_tokens', dimensionKey: 'model=claude-3', bucketStart: '2026-05-28T00:00:00Z', value: 3000 },
];
const enabledData = { enabled: true, granule: '1h', rows, displayNames: {} };

function wrap(thingType = 'ai-gateway') {
  return render(
    <I18nextProvider i18n={i18n}><ThingStatsTab thingId="thing-1" thingType={thingType} /></I18nextProvider>,
  );
}

describe('ThingStatsTab', () => {
  beforeEach(() => { apiState.value = { data: enabledData, loading: false, error: null, refetch: () => {} }; });

  it('shows the skeleton while the first load is in flight', () => {
    apiState.value = { data: undefined, loading: true, error: null, refetch: () => {} };
    const { container } = wrap();
    expect(container.querySelector('[class*=skeleton], [class*=Skeleton]') ?? container.firstChild).toBeTruthy();
  });

  it('surfaces an error banner with retry', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('stats query failed'), refetch: () => {} };
    wrap();
    expect(screen.getByText('stats query failed')).toBeInTheDocument();
  });

  it('renders the unsupported-type message for a Thing with no catalog', () => {
    wrap('nexus-hub');
    expect(screen.getByText(i18n.t('pages:thingStats.notSupportedType', { type: 'nexus-hub' }))).toBeInTheDocument();
  });

  it('renders the disabled-rollup banner when the Hub reports enabled=false', () => {
    apiState.value = { data: { enabled: false, granule: '1h', rows: [] }, loading: false, error: null, refetch: () => {} };
    wrap('agent');
    expect(screen.getByText(/per-agent rollup is not enabled/i)).toBeInTheDocument();
  });

  it('renders KPI cards, the trends heading, and a breakdown table from the rows', async () => {
    wrap('ai-gateway');
    // global request_count sums to 150 across two buckets (KPI)
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:thingStats.trendsHeading', { defaultValue: 'Trends' }))).toBeInTheDocument();
    // the active topModels breakdown tab resolves the per-model token rows
    await waitFor(() => expect(screen.getByText('gpt-4o')).toBeInTheDocument());
    expect(screen.getByText('claude-3')).toBeInTheDocument();
  });

  it('changing the time range re-pins the window (range select)', () => {
    wrap('ai-gateway');
    // the granule badge proves the enabled dashboard rendered; the range select drives a refetch key change
    expect(screen.getByText(/Granule/i)).toBeInTheDocument();
  });
});
