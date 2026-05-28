import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Diagnostics } from '@/pages/diagnostics/Diagnostics';

const api = vi.hoisted(() => ({ agentApi: {
  getDiagnostics: vi.fn(), restartDaemon: vi.fn(), getStatus: vi.fn().mockResolvedValue(null), getAppliedConfig: vi.fn().mockResolvedValue(null),
} }));
vi.mock('@/api/agent', () => api);

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><Diagnostics /></I18nextProvider></QueryClientProvider>);
}

describe('agent Diagnostics', () => {
  it('renders diagnostics from the query (cert path + log tail)', async () => {
    api.agentApi.getDiagnostics.mockResolvedValue({
      hubReachable: true, certPath: '/var/run/nexus/cert.pem', interceptionMode: 'ne', logTail: ['boot ok', 'connected'],
    });
    wrap();
    await waitFor(() => expect(api.agentApi.getDiagnostics).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('/var/run/nexus/cert.pem')).toBeInTheDocument());
    expect(screen.getByText(/boot ok/)).toBeInTheDocument();
  });
});
