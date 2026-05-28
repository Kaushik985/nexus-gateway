import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Overview } from '@/pages/overview/Overview';
import type { StatusSnapshot } from '@/api/agent';

const status = {
  state: 'active', stateReason: '', gatewayConnected: true, paused: false, pausedUntil: null,
  auditQueue: 0, recentEvents: [], todayStats: { totalEvents: 5, blocked: 1, inspected: 4, bytesIn: 0, bytesOut: 0 },
  agent: { version: '1.2.3', deviceID: 'd1', ssoEmail: 'a@x.io', certExpiresAt: '2027-01-01T00:00:00Z', heartbeatIntervalSec: 15, lastHeartbeat: '2026-05-28T00:00:00Z', updateAvailable: false },
} as unknown as StatusSnapshot;

describe('agent Overview', () => {
  it('renders the agent overview from a status snapshot', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><MemoryRouter><Overview status={status} /></MemoryRouter></I18nextProvider></QueryClientProvider>,
    );
    expect(container.textContent).toMatch(/1\.2\.3/); // agent version surfaces
  });
});
