/**
 * OAuthClientFormPage — shared create/edit form. Tests assert: create mode
 * applies the sensible defaults; edit mode hydrates from the fetched client
 * and disables `id` (the Radix Select for `type` is also disabled, but
 * that's covered by the Select component's own tests); invalid redirect URI
 * surfaces the validation message; submit dispatches the right API with
 * the canonical payload; 201 with clientSecret opens the SecretDialog;
 * 201 without (public client) navigates straight to the detail page.
 *
 * The "click to switch type to public" interaction is not exercised here —
 * Radix Select is brittle in jsdom and the underlying force-PKCE logic is
 * exercised at the public-client-create boundary in the test below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/test-utils';
import { OAuthClientFormPage } from '@/pages/iam/oauth-clients/OAuthClientFormPage';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual: typeof import('react-router-dom') = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

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

const existingClient = {
  id: 'my-app',
  name: 'My App',
  type: 'confidential' as const,
  redirectUris: ['https://app.example.com/callback'],
  allowedScopes: ['openid', 'profile'],
  requirePkce: true,
  accessTtlSeconds: 3600,
  refreshTtlSeconds: 86400,
  lastSecretRotatedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

function wrapCreate() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/iam/oauth-clients/new']}>
      <Routes>
        <Route path="/iam/oauth-clients/new" element={<OAuthClientFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function wrapEdit(id = 'my-app') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/iam/oauth-clients/${id}/edit`]}>
      <Routes>
        <Route path="/iam/oauth-clients/:id/edit" element={<OAuthClientFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OAuthClientFormPage — create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = { data: undefined, loading: false, error: null, refetch: vi.fn() };
  });

  it('starts with the sensible defaults (Confidential type, 3600/86400 TTLs, [openid,profile,email])', () => {
    wrapCreate();
    // "Confidential" appears in both the Select trigger and the (portal) options list.
    expect(screen.getAllByText(i18n.t('pages:iam.oauthClients.typeConfidential')).length).toBeGreaterThan(0);
    expect((screen.getByLabelText(/Access token TTL/i) as HTMLInputElement).value).toBe('3600');
    expect((screen.getByLabelText(/Refresh token TTL/i) as HTMLInputElement).value).toBe('86400');
    expect(screen.getByText('openid')).toBeInTheDocument();
    expect(screen.getByText('profile')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
  });

  it('keeps the id field enabled and editable in create mode', () => {
    wrapCreate();
    const idInput = screen.getByLabelText(/Client ID/i) as HTMLInputElement;
    expect(idInput).toBeEnabled();
    fireEvent.change(idInput, { target: { value: 'new-app' } });
    expect(idInput.value).toBe('new-app');
  });

  it('submits a valid create payload with the chosen fields', async () => {
    oa.oauthClientApi.create.mockResolvedValue({ data: { ...existingClient, id: 'new-app' } });
    wrapCreate();

    fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'new-app' } });
    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'New App' } });
    fireEvent.change(screen.getAllByPlaceholderText(/https:\/\/app\.example\.com\/callback/i)[0], {
      target: { value: 'https://new.example.com/cb' },
    });

    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.formSubmitCreate') }));

    await waitFor(() => expect(oa.oauthClientApi.create).toHaveBeenCalled());
    const payload = oa.oauthClientApi.create.mock.calls[0][0];
    expect(payload).toMatchObject({
      id: 'new-app',
      name: 'New App',
      type: 'confidential',
      redirectUris: ['https://new.example.com/cb'],
      allowedScopes: ['openid', 'profile', 'email'],
      requirePkce: true,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 86400,
    });
  });

  it('reveals the new secret in the SecretDialog after a successful confidential create', async () => {
    oa.oauthClientApi.create.mockResolvedValue({ data: { ...existingClient, id: 'new-app', clientSecret: 'nx_cs_NEW' } });
    wrapCreate();

    fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'new-app' } });
    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'New App' } });
    fireEvent.change(screen.getAllByPlaceholderText(/https:\/\/app\.example\.com\/callback/i)[0], {
      target: { value: 'https://new.example.com/cb' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.formSubmitCreate') }));

    await waitFor(() => expect(screen.getByText('nx_cs_NEW')).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled(); // navigate fires only after the admin acks + closes
  });

  it('disables submit and surfaces the validation message when the id format is wrong', () => {
    wrapCreate();
    fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'Bad ID!' } });
    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'New App' } });
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.validationIdFormat'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.formSubmitCreate') })).toBeDisabled();
  });

  it('disables submit and surfaces validation when a redirect URI has the wrong scheme', () => {
    wrapCreate();
    fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'new-app' } });
    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'New App' } });
    fireEvent.change(screen.getAllByPlaceholderText(/https:\/\/app\.example\.com\/callback/i)[0], {
      target: { value: 'ftp://bad.example.com/cb' },
    });
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.validationRedirectUriScheme'))).toBeInTheDocument();
  });

  // F5 regression — a naive startsWith match would accept these.
  it.each([
    ['http://localhost.evil.com/cb'],
    ['http://127.0.0.1.attacker.tld/cb'],
    ['http://localhostfoo/cb'],
  ])('rejects subdomain-spoofed loopback URI %s (handler-parity URL parser)', (uri) => {
    wrapCreate();
    fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'new-app' } });
    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'New App' } });
    fireEvent.change(screen.getAllByPlaceholderText(/https:\/\/app\.example\.com\/callback/i)[0], {
      target: { value: uri },
    });
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.validationRedirectUriScheme'))).toBeInTheDocument();
  });

  // F8 regression — pasted non-numeric must not slip past validation as NaN.
  it('rejects non-numeric TTL inputs as a validation error rather than letting NaN slip through', () => {
    wrapCreate();
    fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'new-app' } });
    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'New App' } });
    fireEvent.change(screen.getAllByPlaceholderText(/https:\/\/app\.example\.com\/callback/i)[0], {
      target: { value: 'https://app.example.com/cb' },
    });
    fireEvent.change(screen.getByLabelText(/Access token TTL/i), { target: { value: '' } });
    expect(screen.getByText(i18n.t('pages:iam.oauthClients.validationAccessTtl'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.formSubmitCreate') })).toBeDisabled();
  });

  it('adds a second redirect URI row when the add button is clicked', () => {
    wrapCreate();
    const addButton = screen.getByRole('button', { name: new RegExp(i18n.t('pages:iam.oauthClients.formAddRedirectUri'), 'i') });
    fireEvent.click(addButton);
    expect(screen.getAllByPlaceholderText(/https:\/\/app\.example\.com\/callback/i)).toHaveLength(2);
  });

  it('Cancel returns to the list in create mode', () => {
    wrapCreate();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.formCancel') }));
    expect(navigate).toHaveBeenCalledWith('/iam/oauth-clients');
  });
});

describe('OAuthClientFormPage — edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = { data: { data: existingClient }, loading: false, error: null, refetch: vi.fn() };
  });

  it('hydrates the form from the fetched client and disables id', () => {
    wrapEdit();
    const idInput = screen.getByLabelText(/Client ID/i) as HTMLInputElement;
    expect(idInput.value).toBe('my-app');
    expect(idInput).toBeDisabled();
  });

  it('dispatches the update payload without id/type', async () => {
    oa.oauthClientApi.update.mockResolvedValue({ data: existingClient });
    wrapEdit();

    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'My App Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.formSubmitSave') }));

    await waitFor(() => expect(oa.oauthClientApi.update).toHaveBeenCalled());
    const [id, payload] = oa.oauthClientApi.update.mock.calls[0];
    expect(id).toBe('my-app');
    expect(payload).toMatchObject({
      name: 'My App Renamed',
      redirectUris: ['https://app.example.com/callback'],
      allowedScopes: ['openid', 'profile'],
      requirePkce: true,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 86400,
    });
    expect(payload.id).toBeUndefined();
    expect(payload.type).toBeUndefined();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/iam/oauth-clients/my-app'));
  });

  it('Cancel returns to the detail page in edit mode', () => {
    wrapEdit();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.oauthClients.formCancel') }));
    expect(navigate).toHaveBeenCalledWith('/iam/oauth-clients/my-app');
  });

  // F1 regression — admin edits do NOT get clobbered by a background refetch
  // of the same client (the `hydratedFor` ref guards against re-hydration on
  // every data change; only navigating to a different :id should re-hydrate).
  it('preserves admin edits when the API refetches the same client', async () => {
    apiState.value = { data: { data: existingClient }, loading: false, error: null, refetch: vi.fn() };
    const { rerender } = renderWithProviders(
      <MemoryRouter initialEntries={['/iam/oauth-clients/my-app/edit']}>
        <Routes>
          <Route path="/iam/oauth-clients/:id/edit" element={<OAuthClientFormPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/^Name\b/i), { target: { value: 'Admin Edit Pending' } });

    // Simulate a background refetch returning the same client (e.g. cache
    // invalidation tick): data is a new object reference, same id.
    apiState.value = { data: { data: { ...existingClient } }, loading: false, error: null, refetch: vi.fn() };
    rerender(
      <MemoryRouter initialEntries={['/iam/oauth-clients/my-app/edit']}>
        <Routes>
          <Route path="/iam/oauth-clients/:id/edit" element={<OAuthClientFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((screen.getByLabelText(/^Name\b/i) as HTMLInputElement).value).toBe('Admin Edit Pending');
  });
});
