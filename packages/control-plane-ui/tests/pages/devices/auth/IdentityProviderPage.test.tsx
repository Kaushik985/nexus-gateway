import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import {
  IdentityProviderPage,
  ScimTokenSection,
  GroupMappingSection,
} from '@/pages/devices/auth/IdentityProviderPage';

const iam = vi.hoisted(() => ({
  iamApi: {
    createScimToken: vi.fn(), revokeScimToken: vi.fn(),
    createIdpGroupMapping: vi.fn(), deleteIdpGroupMapping: vi.fn(),
    listScimTokens: vi.fn(), listIdpGroupMappings: vi.fn(), listGroups: vi.fn(), listIdentityProviders: vi.fn(),
  },
  serviceUrlsApi: { publicURLs: vi.fn() },
}));
vi.mock('@/api/services', () => iam);

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

// useApi switches on the queryKey; each test seeds `apiByKey`.
const apiByKey = vi.hoisted(() => ({ map: {} as Record<string, unknown> }));
function pick(key: unknown[]) {
  if (key.includes('public-urls')) return apiByKey.map.publicUrls;
  if (key.includes('scim-tokens')) return apiByKey.map.tokens;
  if (key.includes('group-mappings')) return apiByKey.map.mappings;
  if (key.includes('idp-picker')) return apiByKey.map.groups;
  if (key.includes('identity-providers')) return apiByKey.map.idps;
  return { data: undefined, loading: false, error: null, refetch: vi.fn() };
}
vi.mock('@/hooks/useApi', () => ({ useApi: (_fn: unknown, key: unknown[]) => pick(key) }));
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));

const idp = { id: 'idp-1', name: 'Okta', type: 'oidc', enabled: true } as never;
function ok(data: unknown) { return { data, loading: false, error: null, refetch: vi.fn() }; }
function wrap(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>);
}

describe('IdentityProviderPage (list)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the local fallback card + external IdP cards', () => {
    apiByKey.map.idps = ok({ data: [
      { id: 'local-1', name: 'Nexus Local', type: 'local', enabled: true },
      idp,
    ] });
    wrap(<IdentityProviderPage />);
    expect(screen.getByText('Nexus Local')).toBeInTheDocument();
    expect(screen.getByText('Okta')).toBeInTheDocument();
  });

  it('shows the empty state when there are no external IdPs', () => {
    apiByKey.map.idps = ok({ data: [{ id: 'local-1', name: 'Nexus Local', type: 'local', enabled: true }] });
    wrap(<IdentityProviderPage />);
    expect(screen.getByText(i18n.t('pages:identityProvider.emptyState.title'))).toBeInTheDocument();
  });

  it('Add Identity Provider navigates to the new-IdP route', () => {
    apiByKey.map.idps = ok({ data: [] });
    wrap(<IdentityProviderPage />);
    fireEvent.click(screen.getByRole('button', { name: /add identity provider/i }));
    expect(navigate).toHaveBeenCalled();
  });

  it('clicking an external IdP card navigates to its detail route', () => {
    apiByKey.map.idps = ok({ data: [idp] });
    wrap(<IdentityProviderPage />);
    fireEvent.click(screen.getByText('Okta'));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('idp-1'));
  });

  it('renders an error banner when the IdP list fails', () => {
    apiByKey.map.idps = { data: undefined, loading: false, error: new Error('list failed'), refetch: vi.fn() };
    wrap(<IdentityProviderPage />);
    expect(screen.getByText('list failed')).toBeInTheDocument();
  });
});

describe('ScimTokenSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.map.publicUrls = ok({ controlPlane: 'https://cp.example.com' });
    apiByKey.map.tokens = ok({ data: [{ id: 'tok-1', name: 'ci-token', tokenPrefix: 'scim_ab', createdBy: 'admin', createdAt: '2026-05-01T00:00:00Z', lastUsedAt: null }], total: 1 });
    iam.iamApi.createScimToken.mockResolvedValue({ token: 'scim_plaintext_secret' });
    iam.iamApi.revokeScimToken.mockResolvedValue(undefined);
  });

  it('renders the SCIM endpoint + existing token rows', () => {
    wrap(<ScimTokenSection idp={idp} />);
    expect(screen.getByText('https://cp.example.com/scim/v2')).toBeInTheDocument();
    expect(screen.getByText('ci-token')).toBeInTheDocument();
  });

  it('generate-token validates a blank name', () => {
    wrap(<ScimTokenSection idp={idp} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:identityProvider.generateToken') }));
    const dialogGenerate = screen.getAllByRole('button', { name: i18n.t('pages:identityProvider.generateToken') }).at(-1)!;
    fireEvent.click(dialogGenerate);
    expect(screen.getByText(i18n.t('pages:identityProvider.tokenNameRequired'))).toBeInTheDocument();
    expect(iam.iamApi.createScimToken).not.toHaveBeenCalled();
  });

  it('generate-token with a name calls createScimToken', async () => {
    wrap(<ScimTokenSection idp={idp} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:identityProvider.generateToken') }));
    fireEvent.change(screen.getByPlaceholderText(i18n.t('pages:identityProvider.tokenNamePlaceholder')), { target: { value: 'new-ci' } });
    const dialogGenerate = screen.getAllByRole('button', { name: i18n.t('pages:identityProvider.generateToken') }).at(-1)!;
    fireEvent.click(dialogGenerate);
    await waitFor(() => expect(iam.iamApi.createScimToken).toHaveBeenCalledWith('idp-1', 'new-ci'));
  });

  it('revoke confirms then calls revokeScimToken', async () => {
    wrap(<ScimTokenSection idp={idp} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:identityProvider.revokeToken') }));
    const confirm = screen.getAllByRole('button', { name: i18n.t('pages:identityProvider.revokeToken') }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(iam.iamApi.revokeScimToken).toHaveBeenCalledWith('idp-1', 'tok-1'));
  });
});

describe('GroupMappingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.map.mappings = ok({ data: [{ id: 'map-1', externalGroupId: 'eng', externalGroupName: 'Engineering', iamGroupId: 'g-1', iamGroupName: 'Admins', createdAt: '2026-05-01T00:00:00Z' }], total: 1 });
    apiByKey.map.groups = ok({ data: [{ id: 'g-1', name: 'Admins' }], total: 1 });
    iam.iamApi.createIdpGroupMapping.mockResolvedValue({ id: 'map-2' });
    iam.iamApi.deleteIdpGroupMapping.mockResolvedValue(undefined);
  });

  it('renders existing group mappings', () => {
    wrap(<GroupMappingSection idp={idp} />);
    expect(screen.getByText('eng')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
  });

  it('add-mapping validates the required fields', () => {
    wrap(<GroupMappingSection idp={idp} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:identityProvider.addMapping') }));
    const dialogAdd = screen.getAllByRole('button', { name: i18n.t('pages:identityProvider.addMapping') }).at(-1)!;
    fireEvent.click(dialogAdd);
    expect(screen.getByText(i18n.t('pages:identityProvider.mappingFieldsRequired'))).toBeInTheDocument();
    expect(iam.iamApi.createIdpGroupMapping).not.toHaveBeenCalled();
  });

  it('add-mapping with ext id + iam group calls createIdpGroupMapping', async () => {
    wrap(<GroupMappingSection idp={idp} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:identityProvider.addMapping') }));
    fireEvent.change(screen.getByPlaceholderText(i18n.t('pages:identityProvider.externalGroupIdPlaceholder')), { target: { value: 'sales' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'g-1' } });
    const dialogAdd = screen.getAllByRole('button', { name: i18n.t('pages:identityProvider.addMapping') }).at(-1)!;
    fireEvent.click(dialogAdd);
    await waitFor(() => expect(iam.iamApi.createIdpGroupMapping).toHaveBeenCalledWith('idp-1', expect.objectContaining({ externalGroupId: 'sales', iamGroupId: 'g-1' })));
  });

  it('delete confirms then calls deleteIdpGroupMapping', async () => {
    wrap(<GroupMappingSection idp={idp} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:delete') }));
    const confirm = screen.getAllByRole('button', { name: i18n.t('common:delete') }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(iam.iamApi.deleteIdpGroupMapping).toHaveBeenCalledWith('idp-1', 'map-1'));
  });
});
