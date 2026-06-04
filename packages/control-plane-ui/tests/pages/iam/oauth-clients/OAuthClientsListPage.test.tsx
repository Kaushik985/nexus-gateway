/**
 * OAuthClientsListPage — renders the registered OAuth clients and routes
 * the delete kebab through the type-to-confirm dialog. Tests assert the
 * row shape, the type pill, navigation on row click, and that the delete
 * flow refetches the single client to populate the live refresh-token
 * count before opening the confirm dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/test-utils';
import { OAuthClientsListPage } from '@/pages/iam/oauth-clients/OAuthClientsListPage';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual: typeof import('react-router-dom') = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true, // grant create + delete in tests
}));

const oa = vi.hoisted(() => ({
  oauthClientApi: { list: vi.fn(), getOne: vi.fn(), create: vi.fn(), update: vi.fn(), rotateSecret: vi.fn(), remove: vi.fn() },
}));
vi.mock('@/api/services', () => oa);

vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));

const apiState = vi.hoisted(() => ({
  value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() },
}));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const sampleClient = {
  id: 'my-app',
  name: 'My Application',
  type: 'confidential',
  redirectUris: ['https://app.example.com/callback'],
  allowedScopes: ['openid', 'profile'],
  requirePkce: true,
  accessTtlSeconds: 3600,
  refreshTtlSeconds: 86400,
  lastSecretRotatedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

function wrap() {
  return renderWithProviders(
    <MemoryRouter><OAuthClientsListPage /></MemoryRouter>,
  );
}

describe('OAuthClientsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = { data: { data: [sampleClient] }, loading: false, error: null, refetch: vi.fn() };
    oa.oauthClientApi.getOne.mockResolvedValue({ data: { ...sampleClient, activeRefreshTokenCount: 4 } });
    oa.oauthClientApi.remove.mockResolvedValue({});
  });

  it('renders each registered client by id + name', () => {
    wrap();
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.getByText('My Application')).toBeInTheDocument();
    expect(screen.getByText('Confidential')).toBeInTheDocument();
  });

  it('renders the empty state when the list is empty', () => {
    apiState.value = { data: { data: [] }, loading: false, error: null, refetch: vi.fn() };
    wrap();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.emptyState'))).toBeInTheDocument();
  });

  it('surfaces a load error via ErrorBanner', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('list failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('list failed')).toBeInTheDocument();
  });

  it('navigates to the Create page when the header button is clicked', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.createButton') }));
    expect(navigate).toHaveBeenCalledWith('/iam/oauth-clients/new');
  });

  it('delete kebab opens the confirm dialog with the live refresh-token count', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:delete') }));
    await waitFor(() => expect(oa.oauthClientApi.getOne).toHaveBeenCalledWith('my-app'));
    await waitFor(() => expect(screen.getByText(/4 active refresh tokens will be revoked/i)).toBeInTheDocument());
  });

  it('confirm fires the remove mutation with the client id', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:delete') }));
    const input = await screen.findByLabelText(/Type my-app to confirm/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-app' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.deleteConfirmDelete') }));
    await waitFor(() => expect(oa.oauthClientApi.remove).toHaveBeenCalledWith('my-app'));
  });

  it('row click navigates to the detail page', () => {
    wrap();
    fireEvent.click(screen.getByText('my-app'));
    expect(navigate).toHaveBeenCalledWith('/iam/oauth-clients/my-app');
  });
});
