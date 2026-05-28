import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIamUserDetail } from '@/pages/iam/user-detail/useIamUserDetail';

const mutateCalls: unknown[] = [];
let user: Record<string, unknown> | undefined;
const VALID_UUID = '11111111-2222-3333-4444-555555555555';

vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'u-1' }), useNavigate: () => vi.fn() }));
vi.mock('react-i18next', async (o) => ({ ...(await o<typeof import('react-i18next')>()), useTranslation: () => ({ t: (k: string) => k }) as never }));
vi.mock('@/hooks/useApi', () => ({
  useApi: (_fn: unknown, key: string[]) => {
    if (key.includes('detail')) return { data: user, loading: false, error: null, refetch: vi.fn() };
    return { data: { data: [] } };
  },
}));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: (a: unknown) => mutateCalls.push(a), loading: false }) }));
vi.mock('@/api/services', () => ({ iamApi: {} }));

describe('useIamUserDetail', () => {
  beforeEach(() => {
    mutateCalls.length = 0;
    user = {
      id: 'u-1', displayName: 'Ada', email: 'ada@x.io', status: 'active',
      organizationId: VALID_UUID, canAccessControlPlane: true,
      policyAttachments: [
        { source: 'group', groupId: 'g1', groupName: 'Admins' },
        { source: 'group', groupId: 'g1', groupName: 'Admins' }, // dup → deduped
        { source: 'direct', policyName: 'p1' },
      ],
    };
  });

  it('dedupes group roles from policy attachments', () => {
    const { result } = renderHook(() => useIamUserDetail());
    expect(result.current.currentRoles).toEqual([{ groupId: 'g1', groupName: 'Admins' }]);
  });

  it('startEditing seeds edit state (status→enabled, valid org UUID kept)', () => {
    const { result } = renderHook(() => useIamUserDetail());
    act(() => result.current.startEditing());
    expect(result.current.isEditing).toBe(true);
    expect(result.current.editDisplayName).toBe('Ada');
    expect(result.current.editEnabled).toBe(true);
    expect(result.current.editOrgId).toBe(VALID_UUID);
  });

  it('startEditing drops a non-UUID organizationId', () => {
    user = { ...user, organizationId: 'not-a-uuid' };
    const { result } = renderHook(() => useIamUserDetail());
    act(() => result.current.startEditing());
    expect(result.current.editOrgId).toBe('');
  });

  it('handleSave builds the update payload (blank→undefined, org conditional)', () => {
    const { result } = renderHook(() => useIamUserDetail());
    act(() => result.current.startEditing());
    act(() => result.current.handleSave());
    expect(mutateCalls).toContainEqual(
      expect.objectContaining({ displayName: 'Ada', email: 'ada@x.io', enabled: true, canAccessControlPlane: true, organizationId: VALID_UUID }),
    );
  });

  it('handleResetPassword requires a matching confirmation', () => {
    const { result } = renderHook(() => useIamUserDetail());
    act(() => { result.current.setResetPassword('secret123'); result.current.setResetPasswordConfirm('different'); });
    act(() => result.current.handleResetPassword());
    expect(mutateCalls).toHaveLength(0); // mismatch → no mutate
    act(() => result.current.setResetPasswordConfirm('secret123'));
    act(() => result.current.handleResetPassword());
    expect(mutateCalls).toContain('secret123');
  });

  it('handleCreateKey no-ops on blank name, submits name+ownerUserId otherwise', () => {
    const { result } = renderHook(() => useIamUserDetail());
    act(() => result.current.handleCreateKey());
    expect(mutateCalls).toHaveLength(0);
    act(() => result.current.setNewKeyName('  ci-key  '));
    act(() => result.current.handleCreateKey());
    expect(mutateCalls).toContainEqual({ name: 'ci-key', ownerUserId: 'u-1' });
  });
});
