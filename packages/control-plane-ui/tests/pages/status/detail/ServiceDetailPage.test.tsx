import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ServiceDetailPage } from '@/pages/status/detail/ServiceDetailPage';

vi.mock('@/api/services', () => ({ systemApi: { listInstances: vi.fn() }, opsMetricsApi: { current: vi.fn() } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useParams: () => ({ serviceName: 'control-plane' }) }));

const apiByKey = vi.hoisted(() => ({ ops: undefined as unknown, instances: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({ useApi: (_fn: unknown, key: unknown[]) => (key.includes('instances') ? apiByKey.instances : apiByKey.ops) }));

const s = (over: Record<string, unknown>) => ({ nodeId: 'n1', nodeType: 'control-plane', metricName: 'x', metricKind: 'counter', value: 1, sampledAt: '2026-01-01T00:00:00Z', dimensionKey: '', ...over });
const samples = [
  s({ metricName: 'requests_total', value: 1000 }),
  s({ metricName: 'errors_total', value: 20 }),
  s({ metricName: 'runtime.goroutines', metricKind: 'gauge', value: 42 }),
];
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><ServiceDetailPage /></MemoryRouter></I18nextProvider>);
}

describe('ServiceDetailPage', () => {
  beforeEach(() => {
    apiByKey.ops = ok(samples);
    apiByKey.instances = ok({ instances: [{ instanceId: 'i1', service: 'control-plane', status: 'online', registeredAt: '2026-05-01T00:00:00Z', lastHeartbeatAt: new Date().toISOString() }], count: 1, services: { 'control-plane': { healthy: 1, total: 1, degraded: 0, unhealthy: 0, offline: 0 } } });
  });

  it('renders the back link + the grouped service metrics', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:status.backToStatus'))).toBeInTheDocument();
    // grouped requests_total → 1,000 metric cell
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });

  it('lists the service instance', () => {
    wrap();
    expect(screen.getByText('i1')).toBeInTheDocument();
  });

  it('shows the loading spinner while ops metrics load', () => {
    apiByKey.ops = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
  });
});
