import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Traffic } from '@/pages/traffic/Traffic';

const api = vi.hoisted(() => ({ agentApi: { queryEvents: vi.fn(), eventById: vi.fn().mockResolvedValue({ id: 'ev1' }) } }));
vi.mock('@/api/agent', () => api);
vi.mock('@/theme/ThemeProvider', () => ({ useTheme: () => ({ mode: 'light', resolvedMode: 'light', setMode: vi.fn(), themeId: 'default', setThemeId: vi.fn(), theme: { charts: {} } }) }));

const events = [
  { id: 'ev1', destHost: 'api.openai.com', processName: 'curl', action: 'inspect', domainRuleId: 'd1', hookDecision: 'approve', bumpStatus: 'BUMP_SUCCESS', occurredAt: '2026-05-28T00:00:00Z', method: 'POST', path: '/v1/chat' },
  { id: 'ev2', destHost: 'example.com', processName: 'node', action: 'relay', domainRuleId: '', occurredAt: '2026-05-28T00:01:00Z', method: 'GET', path: '/' },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><Traffic /></I18nextProvider></QueryClientProvider>);
}

describe('agent Traffic', () => {
  beforeEach(() => { api.agentApi.queryEvents.mockReset(); api.agentApi.queryEvents.mockResolvedValue({ events, total: 2 }); });

  it('queries + renders traffic events with classification', async () => {
    wrap();
    await waitFor(() => expect(api.agentApi.queryEvents).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('api.openai.com')).toBeInTheDocument());
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('re-queries when the action filter changes', async () => {
    wrap();
    await waitFor(() => expect(api.agentApi.queryEvents).toHaveBeenCalled());
    const calls = api.agentApi.queryEvents.mock.calls.length;
    // change the "since" window select (first combobox) to trigger a re-query
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: selects[0].querySelectorAll('option')[1]?.getAttribute('value') ?? '' } });
    await waitFor(() => expect(api.agentApi.queryEvents.mock.calls.length).toBeGreaterThan(calls));
  });

  it('opens the detail drawer when a row is clicked', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('api.openai.com')).toBeInTheDocument());
    fireEvent.click(screen.getByText('api.openai.com'));
    await waitFor(() => expect(api.agentApi.eventById).toHaveBeenCalledWith('ev1'));
  });
});
