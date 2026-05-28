import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { HooksList } from '@/pages/policies/HooksList';
const trigger = vi.fn(); const clearError = vi.fn();
const data = { hooks: [ { id: 'h1', name: 'PII Scanner', priority: 1, implementationId: 'pii', stage: 'request', enabled: true } ] };
vi.mock('@/pages/policies/useAppliedConfig', () => ({
  useAppliedConfig: () => ({ data, isLoading: false }),
  useRefreshPolicies: () => ({ refreshing: false, error: null, trigger, clearError }),
}));
const wrap = () => render(<I18nextProvider i18n={i18n}><MemoryRouter><HooksList /></MemoryRouter></I18nextProvider>);
describe('HooksList', () => {
  beforeEach(() => { trigger.mockClear(); });
  it('renders hook rows + refresh; search filters', () => {
    wrap();
    expect(screen.getAllByText(/PII Scanner/).length).toBeGreaterThan(0);
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'zzz-none' } });
    expect(screen.queryByText(/PII Scanner/)).toBeNull();
  });
  it('refresh button triggers a policy refresh', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(trigger).toHaveBeenCalled();
  });
});
