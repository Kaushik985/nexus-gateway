import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RulePackDetail } from '@/pages/policies/RulePackDetail';
const params = { value: { id: 'rp1' } };
vi.mock('react-router-dom', async (o) => ({ ...(await o<typeof import('react-router-dom')>()), useParams: () => params.value }));
const data = { rulePacks: [{ id: 'rp1', name: 'GDPR Pack', maintainer: 'sec', boundHookId: 'h1', enabled: true, rules: [] }] };
vi.mock('@/pages/policies/useAppliedConfig', () => ({ useAppliedConfig: () => ({ data, isLoading: false }), useRefreshPolicies: () => ({ refreshing: false, error: null, trigger: vi.fn(), clearError: vi.fn() }) }));
const wrap = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><RulePackDetail /></MemoryRouter></I18nextProvider>);
describe('RulePackDetail', () => {
  it('renders the matched rule pack', () => { params.value = { id: 'rp1' }; wrap(); expect(screen.getAllByText(/GDPR Pack/).length).toBeGreaterThan(0); });
  it('handles a missing id', () => { params.value = { id: 'gone' }; wrap(); expect(screen.queryByText(/GDPR Pack/)).toBeNull(); });
});
