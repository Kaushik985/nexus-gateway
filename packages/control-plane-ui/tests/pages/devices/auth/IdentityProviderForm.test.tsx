import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IdentityProviderForm } from '@/pages/devices/auth/IdentityProviderForm';

const iam = vi.hoisted(() => ({ iamApi: { testCandidateIdentityProvider: vi.fn() } }));
vi.mock('@/api/services', () => iam);
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void; onError?: (e: Error) => void }) => ({
    mutate: async (arg: unknown) => { try { const r = await fn(arg); opts?.onSuccess?.(r); return r; } catch (e) { opts?.onError?.(e as Error); } },
    loading: false,
  }),
}));

function wrap(props: Partial<React.ComponentProps<typeof IdentityProviderForm>> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <IdentityProviderForm mode="create" submitting={false} onSubmit={onSubmit} onCancel={onCancel} {...props} />
    </I18nextProvider>,
  );
  return { onSubmit, onCancel };
}

describe('IdentityProviderForm', () => {
  beforeEach(() => { vi.clearAllMocks(); iam.iamApi.testCandidateIdentityProvider.mockResolvedValue({ ok: true, elapsedMs: 42 }); });

  it('defaults to OIDC and shows the OIDC fields', () => {
    wrap();
    expect(screen.getByText(/Issuer URL/i)).toBeInTheDocument();
  });

  it('Save is gated on a display name, then submits an OIDC write request', () => {
    const { onSubmit } = wrap();
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Acme Okta'), { target: { value: 'Acme Okta IdP' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'oidc', name: 'Acme Okta IdP' }));
  });

  it('switching to SAML reveals the SAML-specific fields', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /SAML 2\.0/ }));
    expect(screen.getByText(/Entity ID/i)).toBeInTheDocument();
    expect(screen.getByText(/SSO URL/i)).toBeInTheDocument();
  });

  it('Test connection probes the candidate IdP and surfaces the OK result', async () => {
    wrap();
    fireEvent.change(screen.getByPlaceholderText('Acme Okta'), { target: { value: 'Okta' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:identityProvider.wizard.testConnection', 'Test connection') }));
    await waitFor(() => expect(iam.iamApi.testCandidateIdentityProvider).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(i18n.t('pages:identityProvider.wizard.probeOk', 'Connection OK'))).toBeInTheDocument());
  });

  it('edit mode hydrates from the initial IdP and locks the protocol picker', () => {
    wrap({
      mode: 'edit',
      initial: { id: 'i1', type: 'oidc', name: 'Existing Okta', enabled: true, config: { issuer: 'https://x', clientId: 'c' } } as never,
    });
    expect(screen.getByDisplayValue('Existing Okta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /OIDC/ })).toBeDisabled();
  });

  it('Cancel invokes onCancel', () => {
    const { onCancel } = wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:cancel', 'Cancel') }));
    expect(onCancel).toHaveBeenCalled();
  });
});
