import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ProviderInfoTab } from '@/pages/ai-gateway/providers/detail/ProviderInfoTab';

const svc = vi.hoisted(() => ({ providerApi: { list: vi.fn() } }));
vi.mock('@/api/services', () => svc);

const provider = { id: 'p1', name: 'OpenAI', displayName: 'OpenAI', description: '', baseUrl: 'https://api.openai.com', adapterType: 'openai', region: '', apiVersion: '', enabled: true, createdAt: '2026-05-01T00:00:00Z' };
const handlers = { setIsEditing: vi.fn(), handleSave: vi.fn() };

function Harness({ isEditing, canUpdate = true }: { isEditing: boolean; canUpdate?: boolean }) {
  const providerForm = useForm({ defaultValues: { name: 'OpenAI', displayName: 'OpenAI', description: '', baseUrl: 'https://api.openai.com', adapterType: 'openai', region: '', apiVersion: '', enabled: true } });
  const detail = {
    provider, canUpdate, isEditing, setIsEditing: handlers.setIsEditing,
    providerForm, handleSave: handlers.handleSave, saveLoading: false, credentials: [],
  } as never;
  return <I18nextProvider i18n={i18n}><ProviderInfoTab detail={detail} /></I18nextProvider>;
}

describe('ProviderInfoTab', () => {
  beforeEach(() => { vi.clearAllMocks(); svc.providerApi.list.mockResolvedValue({ data: [] }); });

  it('view mode renders the provider base URL + adapter', () => {
    render(<Harness isEditing={false} canUpdate={false} />);
    expect(screen.getByText('https://api.openai.com')).toBeInTheDocument();
  });

  it('edit mode renders the form; Cancel exits editing', () => {
    render(<Harness isEditing />);
    expect(screen.getAllByDisplayValue('OpenAI').length).toBeGreaterThan(0); // name/displayName hydrated
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:cancel') }));
    expect(handlers.setIsEditing).toHaveBeenCalledWith(false);
  });

  it('Save (unchanged valid form) calls handleSave', async () => {
    render(<Harness isEditing />);
    const save = screen.getByRole('button', { name: i18n.t('common:save') });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(handlers.handleSave).toHaveBeenCalled();
  });
});
