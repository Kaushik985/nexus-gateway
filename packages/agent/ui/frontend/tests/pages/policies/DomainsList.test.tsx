import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { DomainsList } from '@/pages/policies/DomainsList';
const trigger = vi.fn(); const clearError = vi.fn();
const data = { interceptionDomains: [ { id: 'd1', hostPattern: 'api.openai.com', name: 'OpenAI', adapterId: 'openai', enabled: true } ] };
vi.mock('@/pages/policies/useAppliedConfig', () => ({
  useAppliedConfig: () => ({ data, isLoading: false }),
  useRefreshPolicies: () => ({ refreshing: false, error: null, trigger, clearError }),
}));
const wrap = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><DomainsList /></MemoryRouter></I18nextProvider>);
describe('DomainsList', () => {
  beforeEach(() => { trigger.mockClear(); });
  it('renders domain rows; search filters by host', () => {
    wrap();
    expect(screen.getAllByText(/api\.openai\.com/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nomatch' } });
    expect(screen.queryByText(/api\.openai\.com/)).toBeNull();
  });
  it('refresh triggers', () => { wrap(); fireEvent.click(screen.getByRole('button', { name: /refresh/i })); expect(trigger).toHaveBeenCalled(); });
});
