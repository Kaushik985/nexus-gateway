import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { AccountProfileTab } from '@/pages/account/AccountProfileTab';
import { api } from '@/api/client';

vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ principalType: 'admin_user', refreshSession: vi.fn().mockResolvedValue(undefined) }) }));
const apiState = vi.hoisted(() => ({ value: { data: undefined as unknown, loading: false, error: null as Error | null, refetch: vi.fn() } }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiState.value }));

const user = { displayName: 'Alice', email: 'alice@nexus.ai', preferredTimezone: 'UTC', createdAt: '2026-05-01T00:00:00Z' };
function ok(d: unknown) { return { data: d, loading: false, error: null, refetch: vi.fn() }; }
function wrap() { return render(<I18nextProvider i18n={i18n}><AccountProfileTab /></I18nextProvider>); }

describe('AccountProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.value = ok(user);
    vi.spyOn(api, 'patch').mockResolvedValue({} as never);
  });

  it('renders the profile (name + email)', () => {
    wrap();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@nexus.ai')).toBeInTheDocument();
  });

  it('renders the error branch', () => {
    apiState.value = { data: undefined, loading: false, error: new Error('profile load failed'), refetch: vi.fn() };
    wrap();
    expect(screen.getByText('profile load failed')).toBeInTheDocument();
  });

  it('Edit → Save PATCHes /api/my/profile with the edited fields', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:edit') }));
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/my/profile', expect.objectContaining({ username: 'Alice', email: 'alice@nexus.ai', preferredTimezone: 'UTC' })));
  });

  it('Change password → Save PATCHes the password change', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:account.changePassword') }));
    const pw = screen.getAllByDisplayValue('').filter((el) => (el as HTMLInputElement).type === 'password');
    fireEvent.change(pw[0], { target: { value: 'oldpw' } });
    fireEvent.change(pw[1], { target: { value: 'newpw123' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:save') }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/my/profile', { currentPassword: 'oldpw', newPassword: 'newpw123' }));
  });
});
