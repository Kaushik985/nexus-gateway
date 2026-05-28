import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { HookDetail } from '@/pages/policies/HookDetail';
const params = { value: { id: 'h1' } };
vi.mock('react-router-dom', async (o) => ({ ...(await o<typeof import('react-router-dom')>()), useParams: () => params.value }));
const data = { hooks: [{ id: 'h1', name: 'PII Scanner', priority: 1, stage: 'request', enabled: true, implementationId: 'pii' }] };
vi.mock('@/pages/policies/useAppliedConfig', () => ({ useAppliedConfig: () => ({ data, isLoading: false }), useRefreshPolicies: () => ({ refreshing: false, error: null, trigger: vi.fn(), clearError: vi.fn() }) }));
const wrap = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><HookDetail /></MemoryRouter></I18nextProvider>);
describe('HookDetail', () => {
  it('renders the matched hook', () => { params.value = { id: 'h1' }; wrap(); expect(screen.getAllByText(/PII Scanner/).length).toBeGreaterThan(0); });
  it('handles a missing id', () => { params.value = { id: 'gone' }; wrap(); expect(screen.queryByText(/PII Scanner/)).toBeNull(); });
});
