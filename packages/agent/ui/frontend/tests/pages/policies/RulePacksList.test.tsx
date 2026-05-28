import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RulePacksList } from '@/pages/policies/RulePacksList';
const trigger = vi.fn(); const clearError = vi.fn();
const data = { rulePacks: [ { id: 'rp1', name: 'GDPR Pack', maintainer: 'sec-team', boundHookId: 'h1', enabled: true } ] };
vi.mock('@/pages/policies/useAppliedConfig', () => ({
  useAppliedConfig: () => ({ data, isLoading: false }),
  useRefreshPolicies: () => ({ refreshing: false, error: null, trigger, clearError }),
}));
const wrap = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><RulePacksList /></MemoryRouter></I18nextProvider>);
describe('RulePacksList', () => {
  beforeEach(() => { trigger.mockClear(); });
  it('renders rule-pack rows; search filters by name', () => {
    wrap();
    expect(screen.getAllByText(/GDPR Pack/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nomatch' } });
    expect(screen.queryByText(/GDPR Pack/)).toBeNull();
  });
  it('refresh triggers', () => { wrap(); fireEvent.click(screen.getByRole('button', { name: /refresh/i })); expect(trigger).toHaveBeenCalled(); });
});
