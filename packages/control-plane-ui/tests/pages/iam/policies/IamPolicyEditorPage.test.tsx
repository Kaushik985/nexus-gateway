import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamPolicyEditorPage } from '@/pages/iam/policies/IamPolicyEditorPage';

const navigate = vi.fn();
const routerState = vi.hoisted(() => ({ params: {} as Record<string, string>, pathname: '/iam/policies/new' }));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
  useParams: () => routerState.params,
  useLocation: () => ({ pathname: routerState.pathname, search: '', hash: '', state: null, key: 'k' }),
}));

const catalog = {
  resources: [
    { service: 'gateway', type: 'provider', nrn: 'nrn:nexus:gateway:*:provider/*', actions: [{ name: 'admin:provider.read' }, { name: 'admin:provider.create' }] },
  ],
};
const policyDoc = {
  Version: '2025-01-01',
  Statement: [{ Sid: 's1', Effect: 'Allow', Action: ['admin:provider.read'], Resource: ['nrn:nexus:gateway:*:provider/*'] }],
};
const policy = { id: 'p1', name: 'Read Providers', description: 'read-only', enabled: true, document: policyDoc };

const apiByKey = vi.hoisted(() => ({ policy: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) =>
    key.includes('action-catalog')
      ? { data: catalog, loading: false, error: null, refetch: vi.fn() }
      : { data: apiByKey.policy, loading: false, error: null, refetch: vi.fn() },
}));
const mutate = vi.fn();
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate, loading: false }) }));

// Drive the Radix Select as a native <select> so the scope dropdowns
// (service / resource) can be exercised without portal/pointer flakiness.
vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    ...actual,
    Select: ({ value, onValueChange, options }: { value?: string; onValueChange: (v: string) => void; options: Array<{ value: string; label: string }> }) => (
      <select aria-label="scope-select" value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});

function wrap(route: string) {
  return render(
    <I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[route]}><IamPolicyEditorPage /></MemoryRouter></I18nextProvider>,
  );
}

describe('IamPolicyEditorPage — create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerState.params = {};
    routerState.pathname = '/iam/policies/new';
    apiByKey.policy = undefined;
  });

  it('renders the create title + a default statement and disables Save until named', () => {
    wrap('/iam/policies/new');
    expect(screen.getAllByText(i18n.t('pages:iam.createIamPolicy')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('submits a new policy once a name is entered', async () => {
    wrap('/iam/policies/new');
    fireEvent.change(screen.getByLabelText(/name/i, { exact: false }), { target: { value: 'my-policy' } });
    const save = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mutate).toHaveBeenCalled();
  });

  it('Add Statement appends a statement card', () => {
    wrap('/iam/policies/new');
    const before = screen.getAllByText(i18n.t('pages:iam.effect', { defaultValue: 'Effect' })).length;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('pages:iam.addStatement'), 'i') }));
    const after = screen.getAllByText(i18n.t('pages:iam.effect', { defaultValue: 'Effect' })).length;
    expect(after).toBeGreaterThan(before);
  });

  it('toggles to JSON view exposing the document textarea', () => {
    wrap('/iam/policies/new');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.jsonView') }));
    expect(screen.getByLabelText(i18n.t('pages:iam.ariaPolicyDocumentJson'))).toBeInTheDocument();
  });

  it('editing the sid field updates the statement', () => {
    wrap('/iam/policies/new');
    const sid = screen.getByPlaceholderText(i18n.t('pages:iam.placeholderSid'));
    fireEvent.change(sid, { target: { value: 'AllowReads' } });
    expect(screen.getByDisplayValue('AllowReads')).toBeInTheDocument();
  });

  it('duplicate copies a statement with a _copy sid; remove deletes it', () => {
    wrap('/iam/policies/new');
    fireEvent.change(screen.getByPlaceholderText(i18n.t('pages:iam.placeholderSid')), { target: { value: 'src' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.duplicate') }));
    expect(screen.getByDisplayValue('src_copy')).toBeInTheDocument();
    // two statements now → two remove buttons; remove the copy
    const removes = screen.getAllByRole('button', { name: i18n.t('pages:iam.remove') });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[1]);
    expect(screen.getAllByRole('button', { name: i18n.t('pages:iam.remove') })).toHaveLength(1);
  });

  it('move down reorders adjacent statements', () => {
    wrap('/iam/policies/new');
    fireEvent.change(screen.getByPlaceholderText(i18n.t('pages:iam.placeholderSid')), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('pages:iam.addStatement'), 'i') }));
    const sids = screen.getAllByPlaceholderText(i18n.t('pages:iam.placeholderSid'));
    fireEvent.change(sids[1], { target: { value: 'second' } });
    // move the first statement down → order becomes [second, first]
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('pages:iam.moveDown') })[0]);
    const after = screen.getAllByPlaceholderText(i18n.t('pages:iam.placeholderSid')) as HTMLInputElement[];
    expect(after[0].value).toBe('second');
    expect(after[1].value).toBe('first');
  });

  it('JSON round-trip: edit document, format it, then switch back to the form', () => {
    wrap('/iam/policies/new');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.jsonView') }));
    const ta = screen.getByLabelText(i18n.t('pages:iam.ariaPolicyDocumentJson'));
    const doc = { Version: '2025-01-01', Statement: [{ Sid: 'X', Effect: 'Allow', Action: ['admin:provider.read'], Resource: ['nrn:nexus:gateway:*:provider/*'] }] };
    fireEvent.change(ta, { target: { value: JSON.stringify(doc) } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.formatJson') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.formView') }));
    // back in form mode: the parsed statement's sid is rendered
    expect(screen.getByDisplayValue('X')).toBeInTheDocument();
  });

  it('switching back from invalid JSON surfaces a validation error and stays in JSON mode', () => {
    wrap('/iam/policies/new');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.jsonView') }));
    fireEvent.change(screen.getByLabelText(i18n.t('pages:iam.ariaPolicyDocumentJson')), { target: { value: '{ not valid json' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.formView') }));
    // textarea is still present (did not switch to form)
    expect(screen.getByLabelText(i18n.t('pages:iam.ariaPolicyDocumentJson'))).toBeInTheDocument();
  });

  it('picking a service then a resource scope reveals that resource\'s actions', async () => {
    wrap('/iam/policies/new');
    const sel = () => screen.getAllByLabelText('scope-select') as HTMLSelectElement[];
    // pick the service scope (the select carrying a "gateway" option)
    const serviceSelect = sel().find((s) => [...s.options].some((o) => o.value === 'gateway'))!;
    expect(serviceSelect).toBeTruthy();
    fireEvent.change(serviceSelect, { target: { value: 'gateway' } });
    // the resource select now appears (carries the catalog "provider" option)
    const resourceSelect = sel().find((s) => [...s.options].some((o) => o.value === 'provider'))!;
    expect(resourceSelect).toBeTruthy();
    fireEvent.change(resourceSelect, { target: { value: 'provider' } });
    // scoping to a concrete resource renders that resource's actions to pick
    expect(await screen.findByText('admin:provider.read')).toBeInTheDocument();
  });

  it('selecting the cross-service wildcard scope stamps admin:* actions', async () => {
    wrap('/iam/policies/new');
    const serviceSelect = (screen.getAllByLabelText('scope-select') as HTMLSelectElement[])
      .find((s) => [...s.options].some((o) => o.value === '__wildcard__'))!;
    fireEvent.change(serviceSelect, { target: { value: '__wildcard__' } });
    // wildcard scope → updateStatement actions = 'admin:*'
    await waitFor(() => expect(screen.getAllByText('admin:*').length).toBeGreaterThan(0));
  });

  it('service + all-resources scope stamps admin:* (service-wildcard)', async () => {
    wrap('/iam/policies/new');
    const sel = () => screen.getAllByLabelText('scope-select') as HTMLSelectElement[];
    fireEvent.change(sel().find((s) => [...s.options].some((o) => o.value === 'gateway'))!, { target: { value: 'gateway' } });
    // resource select → "*" (all resources) = service-wildcard → admin:* actions
    fireEvent.change(sel().find((s) => [...s.options].some((o) => o.value === '*'))!, { target: { value: '*' } });
    await waitFor(() => expect(screen.getAllByText('admin:*').length).toBeGreaterThan(0));
  });

  it('submitting from JSON mode posts the parsed document', async () => {
    wrap('/iam/policies/new');
    fireEvent.change(screen.getByLabelText(/name/i, { exact: false }), { target: { value: 'json-policy' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.jsonView') }));
    const doc = { Version: '2025-01-01', Statement: [{ Effect: 'Allow', Action: ['admin:provider.read'], Resource: ['*'] }] };
    fireEvent.change(screen.getByLabelText(i18n.t('pages:iam.ariaPolicyDocumentJson')), { target: { value: JSON.stringify(doc) } });
    const save = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ name: 'json-policy', document: expect.objectContaining({ Statement: expect.any(Array) }) }));
  });
});

describe('IamPolicyEditorPage — edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerState.params = { id: 'p1' };
    routerState.pathname = '/iam/policies/p1';
    apiByKey.policy = policy;
  });

  it('hydrates the form from the loaded policy', async () => {
    wrap('/iam/policies/p1');
    // edit title renders in both the breadcrumb and the PageHeader
    expect(screen.getAllByText(i18n.t('pages:iam.editIamPolicy')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByDisplayValue('Read Providers')).toBeInTheDocument());
  });

  it('saving an edited policy fires the update mutation', async () => {
    wrap('/iam/policies/p1');
    await waitFor(() => expect(screen.getByDisplayValue('Read Providers')).toBeInTheDocument());
    const save = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Read Providers' }));
  });
});
