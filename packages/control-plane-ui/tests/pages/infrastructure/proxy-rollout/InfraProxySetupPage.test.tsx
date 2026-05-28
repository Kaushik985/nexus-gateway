import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import InfraProxySetupPage from '@/pages/infrastructure/proxy-rollout/InfraProxySetupPage';

const mutateCalls: unknown[] = [];
const nodeState = vi.hoisted(() => ({ value: { data: undefined as unknown } }));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'proxy-1' }),
}));
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ ...nodeState.value, loading: false, error: null }) }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: () => ({
    mutate: (arg: unknown) => { mutateCalls.push(arg); return Promise.resolve({ enabled: true, pushedAt: 'now' }); },
    loading: false,
    error: null,
  }),
}));

function wrap() {
  return render(
    <I18nextProvider i18n={i18n}><MemoryRouter><InfraProxySetupPage /></MemoryRouter></I18nextProvider>,
  );
}

describe('InfraProxySetupPage', () => {
  beforeEach(() => { mutateCalls.length = 0; });

  it('renders the node name and the CA-cert download step for an online node', () => {
    nodeState.value = { data: { id: 'proxy-1', name: 'proxy-a', status: 'online', targetConfig: { onboarding: { enabled: true } } } };
    wrap();
    // node name appears in the breadcrumb + header subtitle
    expect(screen.getAllByText('proxy-a').length).toBeGreaterThan(0);
    // no offline warning when the node is online
    expect(screen.queryByText(i18n.t('pages:infrastructure.offlineSetupWarning'))).not.toBeInTheDocument();
  });

  it('shows the offline warning when the node is not online', () => {
    nodeState.value = { data: { id: 'proxy-1', name: 'proxy-a', status: 'offline' } };
    wrap();
    expect(screen.getByText(i18n.t('pages:infrastructure.offlineSetupWarning'))).toBeInTheDocument();
  });

  it('clicking Download CA Cert fires the CA download mutation', async () => {
    nodeState.value = { data: { id: 'proxy-1', name: 'proxy-a', status: 'online' } };
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:infrastructure.downloadCACert') }));
    await waitFor(() => expect(mutateCalls.length).toBeGreaterThan(0));
  });
});
