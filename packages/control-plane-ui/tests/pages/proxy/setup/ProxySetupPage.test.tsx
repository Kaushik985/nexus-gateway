import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import ProxySetupPage from '@/pages/proxy/setup/ProxySetupPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

function wrap() {
  return render(
    <I18nextProvider i18n={i18n}><MemoryRouter><ProxySetupPage /></MemoryRouter></I18nextProvider>,
  );
}

describe('ProxySetupPage', () => {
  beforeEach(() => { navigate.mockClear(); apiState.value = { data: undefined, loading: false, error: null }; });

  it('shows the empty state when no compliance-proxy nodes are registered', () => {
    apiState.value = { data: { nodes: [] }, loading: false, error: null };
    wrap();
    expect(screen.getByText(i18n.t('pages:infrastructure.noProxyNodes'))).toBeInTheDocument();
  });

  it('surfaces the error banner when the node list fails', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('hub down') };
    wrap();
    expect(screen.getByText('hub down')).toBeInTheDocument();
  });

  it('navigates to the node setup page when an online node is configured', () => {
    apiState.value = {
      data: { nodes: [{ id: 'n-1', name: 'proxy-a', status: 'online' }] },
      loading: false,
      error: null,
    };
    wrap();
    expect(screen.getByText('proxy-a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:infrastructure.configureSetup') }));
    expect(navigate).toHaveBeenCalledWith('/infrastructure/nodes/n-1/setup');
  });

  it('disables the configure button for an offline node', () => {
    apiState.value = {
      data: { nodes: [{ id: 'n-2', name: 'proxy-b', status: 'offline' }] },
      loading: false,
      error: null,
    };
    wrap();
    expect(screen.getByRole('button', { name: i18n.t('pages:infrastructure.configureSetup') })).toBeDisabled();
  });
});
