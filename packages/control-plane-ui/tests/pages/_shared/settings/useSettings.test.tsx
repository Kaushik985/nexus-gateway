import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSettings,
  toDatetimeLocalValue,
  principalTypeLabelText,
  MIN_PASSWORD_LEN,
} from '../../../../src/pages/_shared/settings/useSettings';

// ---- mocks for the hook's collaborators -------------------------------------
const addToast = vi.fn();
const mutateCalls: unknown[] = [];
let whoami: Record<string, unknown> | undefined;
const refetchWhoami = vi.fn();
const refreshSession = vi.fn();

vi.mock('../../../../src/auth/context/AuthContext', () => ({
  useAuth: () => ({ keyName: 'alice', roles: ['admins'], refreshSession }),
}));
vi.mock('../../../../src/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/hooks/useUnsavedChangesWarning', () => ({ useUnsavedChangesWarning: () => {} }));
vi.mock('../../../../src/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) =>
    key.includes('me')
      ? { data: whoami, loading: false, error: null, refetch: refetchWhoami }
      : { data: { data: [{ id: 'k1', name: 'key', enabled: true, expiresAt: null }] }, loading: false, error: null, refetch: vi.fn() },
}));
vi.mock('../../../../src/hooks/useMutation', () => ({
  useMutation: () => ({ mutate: (arg: unknown) => mutateCalls.push(arg), loading: false }),
}));
vi.mock('@/api/services', () => ({ systemApi: { me: vi.fn() }, iamApi: {} }));

describe('useSettings pure helpers', () => {
  it('toDatetimeLocalValue formats ISO → datetime-local, blanks on null/invalid', () => {
    expect(toDatetimeLocalValue(null)).toBe('');
    expect(toDatetimeLocalValue('not-a-date')).toBe('');
    expect(toDatetimeLocalValue('2026-05-27T08:09:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  it('principalTypeLabelText maps principal types', () => {
    expect(principalTypeLabelText('admin_user')).toMatch(/Password account/);
    expect(principalTypeLabelText('api_key')).toBe('API key');
    expect(principalTypeLabelText('weird')).toBe('weird');
    expect(principalTypeLabelText(undefined)).toBe('—');
  });
});

describe('useSettings hook orchestration', () => {
  beforeEach(() => {
    addToast.mockClear();
    mutateCalls.length = 0;
    whoami = { keyName: 'alice', email: 'a@x.io', authPrincipalType: 'admin_user' };
  });

  it('derives canEditProfile from the principal type + seeds the profile form', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.canEditProfile).toBe(true);
    expect(result.current.keys).toHaveLength(1);
    expect(result.current.mainTab).toBe('general');
  });

  it('saveProfile submits the trimmed username + email for an admin_user', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.saveProfile());
    expect(mutateCalls).toContainEqual({ username: 'alice', email: 'a@x.io' });
  });

  it('saveProfile is a no-op for non-editable principals', () => {
    whoami = { keyName: 'svc', authPrincipalType: 'api_key' };
    const { result } = renderHook(() => useSettings());
    act(() => result.current.saveProfile());
    expect(mutateCalls).toHaveLength(0);
  });

  it('changePassword rejects a too-short new password before mutating', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => { await result.current.changePassword(); });
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining(`at least ${MIN_PASSWORD_LEN}`), 'error',
    );
    expect(mutateCalls).toHaveLength(0);
  });

  it('openEdit selects a key + saveEdit submits the patch body', () => {
    const { result } = renderHook(() => useSettings());
    const key = { id: 'k1', name: 'key', enabled: true, expiresAt: null } as never;
    act(() => result.current.openEdit(key));
    expect(result.current.editing).toBe(key);
    act(() => result.current.saveEdit());
    expect(mutateCalls).toContainEqual({ id: 'k1', body: { name: 'key', enabled: true, expiresAt: null } });
  });

  it('tab + dialog setters update state', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.setMainTab('api-keys'));
    expect(result.current.mainTab).toBe('api-keys');
    act(() => result.current.setShowCreate(true));
    expect(result.current.showCreate).toBe(true);
  });

  it('profile/password edit toggles are mutually exclusive', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.startEditProfile());
    expect(result.current.profileEditing).toBe(true);
    expect(result.current.passwordEditing).toBe(false);
    act(() => result.current.startChangePassword());
    expect(result.current.passwordEditing).toBe(true);
    expect(result.current.profileEditing).toBe(false);
    act(() => result.current.cancelPasswordEdit());
    expect(result.current.passwordEditing).toBe(false);
    act(() => result.current.startEditProfile());
    act(() => result.current.cancelProfileEdit());
    expect(result.current.profileEditing).toBe(false);
  });

  it('saveEdit serializes a set expiry to ISO', () => {
    const { result } = renderHook(() => useSettings());
    const key = { id: 'k9', name: 'k', enabled: false, expiresAt: '2026-05-27T08:00:00Z' } as never;
    act(() => result.current.openEdit(key));
    act(() => result.current.saveEdit());
    const call = mutateCalls.find((c) => (c as { id?: string }).id === 'k9') as { body: { expiresAt: string | null } };
    expect(call.body.expiresAt).toMatch(/^2026-05-27T/); // ISO string, not null
  });

  it('deleteKey + setDeleting/setEditing drive the dialog state', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.deleteKey('k1'));
    expect(mutateCalls).toContain('k1');
    const key = { id: 'k1' } as never;
    act(() => result.current.setDeleting(key));
    expect(result.current.deleting).toBe(key);
    act(() => result.current.setEditing(null));
    expect(result.current.editing).toBeNull();
  });
});
