import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { DSARPage } from '@/pages/governance/DSARPage';

const dsar = vi.hoisted(() => ({ dsarApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), fulfill: vi.fn() } }));
vi.mock('../../api/services/compliance/dsar', () => dsar);
vi.mock('@/api/services/compliance/dsar', () => dsar);

const addToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

const apiByKey = vi.hoisted(() => ({ list: undefined as unknown, users: undefined as unknown }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: unknown[]) => (key.includes('users') ? apiByKey.users : apiByKey.list),
}));

const inProgress = { id: 'd1', subjectId: 'u1', type: 'ACCESS', status: 'IN_PROGRESS', notes: 'n', contact: null, createdAt: '2026-05-01T00:00:00Z', completedAt: null };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><DSARPage /></MemoryRouter></I18nextProvider>);
}

describe('DSARPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiByKey.list = ok({ requests: [inProgress], total: 1 });
    apiByKey.users = ok({ data: [{ id: 'u1', displayName: 'Alice', email: 'a@b.c' }] });
    dsar.dsarApi.create.mockResolvedValue({});
    dsar.dsarApi.update.mockResolvedValue({});
    dsar.dsarApi.fulfill.mockResolvedValue({ export: { vk: [{}], proxy: [] } });
  });

  it('renders the queue and resolves the subject to its user display name', () => {
    wrap();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('renders the error branch on failure', () => {
    apiByKey.list = { data: undefined, loading: false, error: new Error('dsar load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('dsar load failed')).toBeInTheDocument();
  });

  it('File request validates a missing subject then creates with the selected user', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('pages:security.dsar.fileRequest', 'File request'), 'i') }));
    const dialog = screen.getByRole('dialog');
    // Save with no subject selected → validation toast, no create
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common:save', 'Save') }));
    expect(dsar.dsarApi.create).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(i18n.t('pages:security.dsar.subjectIdRequired'), 'error');
    // pick the subject + save → create with null contact/notes
    fireEvent.change(within(dialog).getAllByRole('combobox')[0], { target: { value: 'u1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common:save', 'Save') }));
    await waitFor(() => expect(dsar.dsarApi.create).toHaveBeenCalledWith({ subjectId: 'u1', type: 'ACCESS', contact: null, notes: null }));
  });

  it('Fulfill runs the access export and surfaces the result dialog', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:security.dsar.fulfill', 'Fulfill') }));
    // AlertDialog confirm for an ACCESS request = Export
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:security.dsar.confirmExport', 'Export') }));
    await waitFor(() => expect(dsar.dsarApi.fulfill).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(screen.getByText(i18n.t('pages:security.dsar.exportReady', 'Export Ready'))).toBeInTheDocument());
  });
});
