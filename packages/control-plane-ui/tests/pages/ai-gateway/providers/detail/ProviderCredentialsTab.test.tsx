import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ProviderCredentialsTab } from '@/pages/ai-gateway/providers/detail/ProviderCredentialsTab';

const cred = { id: 'c1', name: 'CI Key', enabled: true, status: 'active', circuitState: 'closed', expiresAt: null, lastUsedAt: null };
const h = { createCredential: vi.fn(), toggleCredEnabled: vi.fn(), startEditingCred: vi.fn(), setDeletingCred: vi.fn(), setShowCredForm: vi.fn(), handleCredUpdate: vi.fn(), setEditingCredId: vi.fn() };

function Harness({ showCredForm = false, editingCredId = null }: { showCredForm?: boolean; editingCredId?: string | null }) {
  const newCredForm = useForm({ defaultValues: { credName: 'New Key', credApiKey: 'sk-123', newCredEnabled: true, credExpiresAt: '' } });
  const editCredForm = useForm({ defaultValues: { editCredName: 'CI Key', editCredApiKey: '', editCredEnabled: true, editCredExpiresAt: '' } });
  const detail = {
    id: 'p1', credentials: [cred], canUpdate: true, canDelete: true, canCreateCredential: true,
    showCredForm, setShowCredForm: h.setShowCredForm, newCredForm, createCredential: h.createCredential, credCreating: false,
    editingCredId, setEditingCredId: h.setEditingCredId, editCredForm, handleCredUpdate: h.handleCredUpdate, credUpdating: false,
    startEditingCred: h.startEditingCred, toggleCredEnabled: h.toggleCredEnabled, setDeletingCred: h.setDeletingCred,
  } as never;
  return <I18nextProvider i18n={i18n}><ProviderCredentialsTab detail={detail} /></I18nextProvider>;
}

describe('ProviderCredentialsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the credential row', () => {
    render(<Harness />);
    expect(screen.getByText('CI Key')).toBeInTheDocument();
  });

  it('Add credential toggles the inline form', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:providers.addCredential') }));
    expect(h.setShowCredForm).toHaveBeenCalledWith(true);
  });

  it('with the form open + filled, Create builds the credential payload', () => {
    render(<Harness showCredForm />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:create') }));
    expect(h.createCredential).toHaveBeenCalledWith({ name: 'New Key', providerId: 'p1', apiKey: 'sk-123', enabled: true, expiresAt: undefined });
  });

  it('the row enable toggle flips toggleCredEnabled', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:enabled') }));
    expect(h.toggleCredEnabled).toHaveBeenCalledWith({ id: 'c1', enabled: false });
  });

  it('Edit + Delete invoke the row handlers', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:edit') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:delete') }));
    expect(h.startEditingCred).toHaveBeenCalledWith(cred);
    expect(h.setDeletingCred).toHaveBeenCalledWith(cred);
  });

  it('editing mode renders the inline edit form + Save calls handleCredUpdate', () => {
    render(<Harness editingCredId="c1" />);
    expect(screen.getByText(i18n.t('pages:providers.editing', { name: 'CI Key' }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    expect(h.handleCredUpdate).toHaveBeenCalled();
  });
});
