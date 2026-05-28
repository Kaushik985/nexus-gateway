import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { DomainDetail } from '@/pages/policies/DomainDetail';
const params = { value: { id: 'd1' } };
vi.mock('react-router-dom', async (o) => ({ ...(await o<typeof import('react-router-dom')>()), useParams: () => params.value }));
const data = { interceptionDomains: [{ id: 'd1', hostPattern: 'api.openai.com', name: 'OpenAI', adapterId: 'openai', enabled: true, paths: [] }] };
vi.mock('@/pages/policies/useAppliedConfig', () => ({ useAppliedConfig: () => ({ data, isLoading: false }), useRefreshPolicies: () => ({ refreshing: false, error: null, trigger: vi.fn(), clearError: vi.fn() }) }));
const wrap = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><DomainDetail /></MemoryRouter></I18nextProvider>);
describe('DomainDetail', () => {
  it('renders the matched domain', () => { params.value = { id: 'd1' }; wrap(); expect(screen.getAllByText(/api\.openai\.com/).length).toBeGreaterThan(0); });
  it('handles a missing id (not found)', () => { params.value = { id: 'gone' }; wrap(); expect(screen.queryByText(/api\.openai\.com/)).toBeNull(); });
});
