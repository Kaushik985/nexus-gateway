/**
 * ProviderHealthPage — mocked-useApi providers + health fixtures: title +
 * provider card with its error-rate metric, loading branch. Replaces the smoke
 * test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ProviderHealthPage } from '@/pages/status/detail/ProviderHealthPage';

vi.mock('@/api/services', () => ({ providerApi: { list: vi.fn() }, systemApi: { listProviderHealth: vi.fn() } }));
const apiState = vi.hoisted(() => ({ providers: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() }, health: { data: { data: [] } as unknown, loading: false } }));
vi.mock('@/hooks/useApi', () => ({
  // health query key has the exact element 'health'; providers key has 'health-page'
  useApi: (_fn: unknown, key: string[]) => (key.includes('health') ? apiState.health : apiState.providers),
}));

const provider = { id: 'p1', name: 'openai', displayName: 'OpenAI', enabled: true };
const health = { providerId: 'p1', errorRate: 0.05, status: 'healthy', latencyP95Ms: 120 };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }

describe('ProviderHealthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.providers = ok({ data: [provider] });
    apiState.health = { data: { data: [health] }, loading: false };
  });

  it('renders the title + provider card with its error rate', () => {
    render(<I18nextProvider i18n={i18n}><MemoryRouter><ProviderHealthPage /></MemoryRouter></I18nextProvider>);
    expect(screen.getByText(i18n.t('pages:status.providerHealth.title'))).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('5.0%')).toBeInTheDocument(); // errorRate 0.05 → 5.0%
  });

  it('renders the loading branch', () => {
    apiState.providers = { data: undefined, loading: true, error: null, refetch: vi.fn() };
    const { container } = render(<I18nextProvider i18n={i18n}><MemoryRouter><ProviderHealthPage /></MemoryRouter></I18nextProvider>);
    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText('OpenAI')).toBeNull();
  });
});
