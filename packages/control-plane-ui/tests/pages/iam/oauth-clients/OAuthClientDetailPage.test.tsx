/**
 * OAuthClientDetailPage — 5-card layout for the OAuth client admin detail
 * surface. Tests assert: the rotate-secret action is hidden for public
 * clients; the secret area shows the public copy for public clients; the
 * Activity card surfaces the embedded activeRefreshTokenCount; a rotate
 * call opens the SecretDialog with the new plaintext; and the delete
 * cascade flows through to the API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/test-utils';
import { OAuthClientDetailPage } from '@/pages/iam/oauth-clients/OAuthClientDetailPage';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual: typeof import('react-router-dom') = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true, // grant all 5 verbs in tests
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

const confidentialClient = {
  id: 'my-app',
  name: 'My Application',
  type: 'confidential' as const,
  redirectUris: ['https://app.example.com/callback', 'http://localhost:3001/cb'],
  allowedScopes: ['openid', 'profile', 'admin'],
  requirePkce: true,
  accessTtlSeconds: 3600,
  refreshTtlSeconds: 86400,
  lastSecretRotatedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  activeRefreshTokenCount: 5,
};

const publicClient = { ...confidentialClient, id: 'spa-app', type: 'public' as const, requirePkce: true };

function wrap(id = 'my-app') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/iam/oauth-clients/${id}`]}>
      <Routes>
        <Route path="/iam/oauth-clients/:id" element={<OAuthClientDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OAuthClientDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = { data: { data: confidentialClient }, loading: false, error: null, refetch: vi.fn() };
    oa.oauthClientApi.rotateSecret.mockResolvedValue({ data: { ...confidentialClient, clientSecret: 'nx_cs_NEW_SECRET' } });
    oa.oauthClientApi.remove.mockResolvedValue({});
  });

  it('renders all 5 cards for a confidential client', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.cardAuthentication'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.cardRedirectUris'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.cardAllowedScopes'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.cardSecurity'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.cardActivity'))).toBeInTheDocument();
  });

  it('shows the masked secret + Never rotated copy for a confidential client that has never rotated', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.secretMasked'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.neverRotated'))).toBeInTheDocument();
  });

  it('hides the Rotate secret button for public clients and shows the public-no-secret copy', () => {
    apiState.value = { data: { data: publicClient }, loading: false, error: null, refetch: vi.fn() };
    wrap('spa-app');
    expect(screen.queryByRole('button', { name: i18n.t('pages:iam.oauthClients.rotateSecretButton') })).toBeNull();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.publicClientNoSecret'))).toBeInTheDocument();
  });

  it('surfaces the activeRefreshTokenCount in the Activity card', () => {
    wrap();
    // The count "5" appears in the activity card.
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
  });

  it('renders admin scope chip with the warning tone', () => {
    wrap();
    const adminChip = screen.getAllByTestId('scope-chip').find((c) => c.getAttribute('data-scope') === 'admin');
    expect(adminChip).toBeDefined();
    expect(adminChip!).toHaveAttribute('data-tone', 'warning');
  });

  it('rotate flow opens the SecretDialog with the new plaintext', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.rotateSecretButton') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.rotateConfirmConfirm') }));
    await waitFor(() => expect(oa.oauthClientApi.rotateSecret).toHaveBeenCalledWith('my-app'));
    await waitFor(() => expect(screen.getByText('nx_cs_NEW_SECRET')).toBeInTheDocument());
  });

  it('delete confirm dispatches remove with the client id and navigates back to the list', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:delete') }));
    const input = await screen.findByLabelText(/Type my-app to confirm/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-app' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.deleteConfirmDelete') }));
    await waitFor(() => expect(oa.oauthClientApi.remove).toHaveBeenCalledWith('my-app'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/iam/oauth-clients'));
  });

  it('Edit button navigates to the edit route', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:edit') }));
    expect(navigate).toHaveBeenCalledWith('/iam/oauth-clients/my-app/edit');
  });

  it('renders the not-found banner when the API returns no client', () => {
    apiState.value = { data: { data: null as unknown }, loading: false, error: null, refetch: vi.fn() };
    wrap();
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.notFound'))).toBeInTheDocument();
  });
});
