import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamRoleForm } from '@/pages/iam/roles/IamRoleForm';

const iam = vi.hoisted(() => ({ iamApi: { listPolicies: vi.fn(), createGroup: vi.fn(), updateGroup: vi.fn(), addGroupPolicy: vi.fn() } }));
vi.mock('@/api/services', () => iam);
vi.mock('@/hooks/useMutation', () => ({
  useMutation: (fn: (a: unknown) => Promise<unknown>, opts?: { onSuccess?: (r: unknown) => void | Promise<void> }) => ({
    mutate: async (arg: unknown) => { const r = await fn(arg); await opts?.onSuccess?.(r); return r; },
    loading: false,
  }),
}));

function wrap(props: Partial<React.ComponentProps<typeof IamRoleForm>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onSaved = props.onSaved ?? vi.fn();
  render(<I18nextProvider i18n={i18n}><IamRoleForm onClose={onClose} onSaved={onSaved} {...props} /></I18nextProvider>);
  return { onClose, onSaved };
}

describe('IamRoleForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    iam.iamApi.listPolicies.mockResolvedValue({ data: [{ id: 'p1', name: 'ReadAll' }] });
    iam.iamApi.createGroup.mockResolvedValue({ id: 'g1' });
    iam.iamApi.updateGroup.mockResolvedValue({ id: 'g1' });
    iam.iamApi.addGroupPolicy.mockResolvedValue({});
  });

  it('loads the policy list', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('ReadAll')).toBeInTheDocument());
  });

  it('create: name + selected policy → createGroup then attach + onSaved/onClose', async () => {
    const { onClose, onSaved } = wrap();
    await waitFor(() => expect(screen.getByText('ReadAll')).toBeInTheDocument());
    const [nameInput] = screen.getAllByRole('textbox');
    fireEvent.change(nameInput, { target: { value: 'Admins' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(iam.iamApi.createGroup).toHaveBeenCalledWith({ name: 'Admins', description: null }));
    await waitFor(() => expect(iam.iamApi.addGroupPolicy).toHaveBeenCalledWith('g1', { policyId: 'p1' }));
    await waitFor(() => { expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled(); });
  });

  it('edit: hydrates the role name and updates via updateGroup', async () => {
    wrap({ role: { id: 'g9', name: 'Existing', description: 'd' } as never });
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(iam.iamApi.updateGroup).toHaveBeenCalledWith('g9', { name: 'Existing', description: 'd' }));
  });

  it('Cancel invokes onClose', () => {
    const { onClose } = wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:cancel') }));
    expect(onClose).toHaveBeenCalled();
  });
});
