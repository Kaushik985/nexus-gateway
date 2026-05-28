import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ServiceCard } from '@/pages/status/services/ServiceCard';

const runtime = { goroutines: 50, heapAllocMB: 100, heapSysMB: 200, gcPauseP50Ms: 0.5, gcCount: 10, threads: 8 };
const summary = { healthy: 2, total: 2, degraded: 0, unhealthy: 0, offline: 0 };
const instances = [{ instanceId: 'inst-1', status: 'online', registeredAt: '2026-05-01T00:00:00Z', lastHeartbeatAt: new Date().toISOString() }];

function wrap(serviceName: string, metrics: Record<string, unknown>, svcSummary = summary, insts = instances) {
  return render(
    <I18nextProvider i18n={i18n}><MemoryRouter>
      <ServiceCard serviceName={serviceName} metricSet={{ metrics, runtime } as never} instances={insts as never} serviceSummary={svcSummary} />
    </MemoryRouter></I18nextProvider>,
  );
}

describe('ServiceCard', () => {
  it('ai-gateway renders its business metrics + a detail link', () => {
    wrap('ai-gateway', { requestsTotal: 1000, requestDurationP50Ms: 5, requestDurationP99Ms: 20, tokensPromptTotal: 5000, tokensCompletionTotal: 3000, errorsTotal: 2 });
    expect(screen.getByText('1,000')).toBeInTheDocument(); // requestsTotal
    expect(screen.getByRole('link', { name: i18n.t('pages:status.viewDetail') })).toHaveAttribute('href', '/status/services/ai-gateway');
  });

  it('compliance-proxy surfaces the Redis status', () => {
    wrap('compliance-proxy', { connectionsActive: 5, connectionsTotal: 100, connectionsRejected: 1, tlsHandshakeP50Ms: 3, certCacheHitRate: 0.9, auditQueueDepth: 0, redisAvailable: false });
    expect(screen.getByText(i18n.t('pages:status.redisDown'))).toBeInTheDocument();
  });

  it('expands the runtime panel to show goroutines', () => {
    wrap('control-plane', { requestsTotal: 10, authFailuresTotal: 0, iamDenialsTotal: 0 });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('pages:status.runtime'), 'i') }));
    expect(screen.getByText('50')).toBeInTheDocument(); // goroutines
  });

  it('expands the instances panel to list the instance', () => {
    wrap('control-plane', { requestsTotal: 10 });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('pages:status.instances'), 'i') }));
    expect(screen.getByText('inst-1')).toBeInTheDocument();
  });

  it('shows a danger summary dot when an instance is unhealthy (no crash)', () => {
    expect(() => wrap('ai-gateway', { requestsTotal: 0 }, { healthy: 0, total: 1, degraded: 0, unhealthy: 1, offline: 0 })).not.toThrow();
  });
});
