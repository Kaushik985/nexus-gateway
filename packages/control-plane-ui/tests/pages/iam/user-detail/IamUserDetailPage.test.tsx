/**
 * IamUserDetailPage — mock the useIamUserDetail hook with a user fixture +
 * spies: assert header, action buttons fire the hook setters, and the
 * loading/not-found branches. Replaces the smoke test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { IamUserDetailPage } from '@/pages/iam/user-detail/IamUserDetailPage';

vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => vi.fn() }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => true }));

const spies = vi.hoisted(() => ({
  startEditing: vi.fn(), setDeletingUser: vi.fn(), setIsResettingPassword: vi.fn(), deleteUser: vi.fn(),
  setResetPassword: vi.fn(), setResetPasswordConfirm: vi.fn(), handleResetPassword: vi.fn(), refetch: vi.fn(),
}));
const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/pages/iam/user-detail/useIamUserDetail', () => ({ useIamUserDetail: () => state.value }));

const user = { id: 'u1', displayName: 'Alice', email: 'alice@nexus.ai', status: 'active', consoleAccess: 'enabled', organizationName: 'Acme' };
function base(over: Record<string, unknown> = {}) {
  return {
    user, loading: false, error: null, refetch: spies.refetch,
    deletingUser: false, setDeletingUser: spies.setDeletingUser, deleteUser: spies.deleteUser,
    isEditing: false, startEditing: spies.startEditing,
    isResettingPassword: false, setIsResettingPassword: spies.setIsResettingPassword,
    resetPassword: '', setResetPassword: spies.setResetPassword,
    resetPasswordConfirm: '', setResetPasswordConfirm: spies.setResetPasswordConfirm,
    resetPasswordLoading: false, handleResetPassword: spies.handleResetPassword,
    ...over,
  };
}
function wrap() { return render(<I18nextProvider i18n={i18n}><MemoryRouter><IamUserDetailPage /></MemoryRouter></I18nextProvider>); }

describe('IamUserDetailPage', () => {
  beforeEach(() => { vi.clearAllMocks(); state.value = base(); });

  it('renders the user header + the info/permissions tabs', () => {
    wrap();
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: i18n.t('pages:iam.info') })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: i18n.t('pages:iam.permissions') })).toBeInTheDocument();
  });

  it('Delete opens the delete confirmation; Edit enters edit mode', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:delete') }));
    expect(spies.setDeletingUser).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:edit') }));
    expect(spies.startEditing).toHaveBeenCalled();
  });

  it('renders the loading + not-found branches', () => {
    state.value = base({ loading: true });
    const { unmount } = wrap();
    expect(screen.queryByText('Alice')).toBeNull();
    unmount();
    state.value = base({ user: null });
    wrap();
    expect(screen.getByText(i18n.t('pages:iam.userNotFound'))).toBeInTheDocument();
  });
});
