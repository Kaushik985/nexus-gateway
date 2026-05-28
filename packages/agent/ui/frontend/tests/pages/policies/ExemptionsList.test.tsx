import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ExemptionsList } from '@/pages/policies/ExemptionsList';
const trigger = vi.fn(); const clearError = vi.fn();
const data = { exemptions: [ { id: 'e1', host: 'corp.example.com', user: 'ada', reason: 'legal hold' } ] };
vi.mock('@/pages/policies/useAppliedConfig', () => ({
  useAppliedConfig: () => ({ data, isLoading: false }),
  useRefreshPolicies: () => ({ refreshing: false, error: null, trigger, clearError }),
}));
const wrap = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><ExemptionsList /></MemoryRouter></I18nextProvider>);
describe('ExemptionsList', () => {
  beforeEach(() => { trigger.mockClear(); });
  it('renders exemption rows; search filters by host', () => {
    wrap();
    expect(screen.getAllByText(/corp\.example\.com/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nomatch' } });
    expect(screen.queryByText(/corp\.example\.com/)).toBeNull();
  });
  it('refresh triggers', () => { wrap(); fireEvent.click(screen.getByRole('button', { name: /refresh/i })); expect(trigger).toHaveBeenCalled(); });
});
