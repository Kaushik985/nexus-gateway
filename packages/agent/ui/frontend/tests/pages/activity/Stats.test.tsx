import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Stats } from '@/pages/activity/Stats';

const api = vi.hoisted(() => ({ agentApi: { queryStats: vi.fn() } }));
vi.mock('@/api/agent', () => api);

const rows = [
  { metricName: 'request_count', dimensionKey: '', value: 100, bucketStart: '2026-05-28T00:00:00Z' },
  { metricName: 'request_count', dimensionKey: 'target_host:api.openai.com', value: 60, bucketStart: '2026-05-28T00:00:00Z' },
  { metricName: 'request_count', dimensionKey: 'target_host:example.com', value: 40, bucketStart: '2026-05-28T00:00:00Z' },
  { metricName: 'request_count', dimensionKey: 'source_process:curl', value: 70, bucketStart: '2026-05-28T00:00:00Z' },
  { metricName: 'bytes_in_sum', dimensionKey: '', value: 2048, bucketStart: '2026-05-28T00:00:00Z' },
  { metricName: 'action_deny', dimensionKey: '', value: 3, bucketStart: '2026-05-28T00:00:00Z' },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><Stats /></I18nextProvider></QueryClientProvider>);
}

describe('agent Stats', () => {
  beforeEach(() => { api.agentApi.queryStats.mockReset(); api.agentApi.queryStats.mockResolvedValue({ rows }); });

  it('queries stats and renders the dashboard', async () => {
    wrap();
    await waitFor(() => expect(api.agentApi.queryStats).toHaveBeenCalled());
    // request total aggregates to 100 (global dimension).
    await waitFor(() => expect(screen.getByText('100')).toBeInTheDocument());
  });

  it('issues the global + per-host + per-process breakdown queries', async () => {
    wrap();
    await waitFor(() => expect(api.agentApi.queryStats.mock.calls.length).toBeGreaterThanOrEqual(3));
    const dims = api.agentApi.queryStats.mock.calls.map((c) => (c[0] as { dimension?: string }).dimension);
    expect(dims).toEqual(expect.arrayContaining(['target_host', 'source_process']));
  });
});
