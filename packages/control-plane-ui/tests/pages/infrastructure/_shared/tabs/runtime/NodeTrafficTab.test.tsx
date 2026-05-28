import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { NodeTrafficTab } from '@/pages/infrastructure/_shared/tabs/runtime/NodeTrafficTab';

const apiState = vi.hoisted(() => ({ traffic: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) =>
    key.includes('nodes') && key.includes('traffic')
      ? apiState.traffic
      : { data: undefined, loading: false, error: null, refetch: vi.fn() },
}));

const event = { id: 'e1', timestamp: '2026-05-28T00:00:00Z', targetHost: 'api.openai.com', statusCode: 200, method: 'POST', path: '/v1/chat', source: 'vk' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap(nodeType = 'ai-gateway') {
  return render(
    <I18nextProvider i18n={i18n}><MemoryRouter>
      <NodeTrafficTab nodeId="n1" nodeType={nodeType} nodeName="gw-1" />
    </MemoryRouter></I18nextProvider>,
  );
}

describe('NodeTrafficTab', () => {
  beforeEach(() => { apiState.traffic = ok({ data: [event], total: 1 }); });

  it('renders the traffic rows + a pre-filtered "view all" link', () => {
    // proxy node → proxy columns include targetHost
    wrap('compliance-proxy');
    expect(screen.getByText('api.openai.com')).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', expect.stringContaining('thingId=n1'));
  });

  it('shows the gateway subtitle for an ai-gateway node and the proxy subtitle for a proxy node', () => {
    wrap('ai-gateway');
    expect(screen.getByText(i18n.t('pages:nodeDetail.traffic.subtitleGateway'))).toBeInTheDocument();
    wrap('compliance-proxy');
    expect(screen.getByText(i18n.t('pages:nodeDetail.traffic.subtitleProxy'))).toBeInTheDocument();
  });

  it('renders the loading skeleton + error branch', () => {
    apiState.traffic = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = wrap();
    expect(container.firstChild).toBeTruthy();
    apiState.traffic = { data: undefined, loading: false, error: new Error('node traffic failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('node traffic failed')).toBeInTheDocument();
  });

  it('renders the agent subtitle + agent columns for an agent node', () => {
    wrap('agent');
    expect(screen.getByText(i18n.t('pages:nodeDetail.traffic.subtitleAgent'))).toBeInTheDocument();
    // agent columns include targetHost
    expect(screen.getByText('api.openai.com')).toBeInTheDocument();
  });
});
