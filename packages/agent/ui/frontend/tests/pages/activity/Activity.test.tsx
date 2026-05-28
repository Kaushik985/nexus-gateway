import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Activity } from '@/pages/activity/Activity';

const api = vi.hoisted(() => ({ agentApi: { queryLifecycle: vi.fn() } }));
vi.mock('@/api/agent', () => api);

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><Activity /></I18nextProvider></QueryClientProvider>);
}

describe('agent Activity', () => {
  it('renders lifecycle events from the query', async () => {
    api.agentApi.queryLifecycle.mockResolvedValue({
      events: [{ id: 'e1', action: 'agent.startup', occurredAt: '2026-05-28T00:00:00Z', detail: 'booted' }],
      total: 1,
    });
    wrap();
    await waitFor(() => expect(api.agentApi.queryLifecycle).toHaveBeenCalled());
    // The pagination summary "1–1 of 1" is deterministic (the action label is i18n-translated).
    await waitFor(() => expect(screen.getByText(/of 1/)).toBeInTheDocument());
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1); // header + 1 data row
  });

  it('renders without crashing when there are no events', async () => {
    api.agentApi.queryLifecycle.mockResolvedValue({ events: [], total: 0 });
    const { container } = wrap();
    await waitFor(() => expect(api.agentApi.queryLifecycle).toHaveBeenCalled());
    expect((container.textContent || '').length).toBeGreaterThan(0);
  });
});
