import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { UserPermissionsTab } from '@/pages/iam/user-detail/UserPermissionsTab';

function baseProps(over: Record<string, unknown> = {}) {
  return {
    allPolicies: [],
    showAddRole: false, setShowAddRole: vi.fn(),
    selectedGroupId: '', setSelectedGroupId: vi.fn(),
    removingRole: null, setRemovingRole: vi.fn(),
    currentRoles: [{ id: 'gm1', groupId: 'g1', groupName: 'Admins' }],
    availableGroups: [{ id: 'g2', name: 'Viewers' }],
    addToGroup: vi.fn(), addGroupLoading: false,
    removeFromGroup: vi.fn(), removeGroupLoading: false,
    showAttachPolicy: false, setShowAttachPolicy: vi.fn(),
    selectedPolicyId: '', setSelectedPolicyId: vi.fn(),
    detachingPolicy: null, setDetachingPolicy: vi.fn(),
    availablePolicies: [{ id: 'p1', name: 'ReadAll' }],
    attachPolicy: vi.fn(), attachPolicyLoading: false,
    detachPolicy: vi.fn(), detachPolicyLoading: false,
    ...over,
  } as never;
}
function wrap(over: Record<string, unknown> = {}) {
  const props = baseProps(over);
  render(<I18nextProvider i18n={i18n}><MemoryRouter><UserPermissionsTab {...props} /></MemoryRouter></I18nextProvider>);
  return props as Record<string, ReturnType<typeof vi.fn>>;
}

describe('UserPermissionsTab', () => {
  it('renders the effective-policies + roles sections with the current role', () => {
    wrap();
    expect(screen.getByText(i18n.t('pages:iam.effectivePolicies'))).toBeInTheDocument();
    expect(screen.getByText('Admins')).toBeInTheDocument();
  });

  it('Attach policy toggles the inline form', () => {
    const props = wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.attachPolicy') }));
    expect(props.setShowAttachPolicy).toHaveBeenCalledWith(true);
  });

  it('with the attach form open, the available policy is listed as an option', () => {
    wrap({ showAttachPolicy: true, selectedPolicyId: 'p1' });
    // the inline policy select renders the available policy option
    expect(screen.getByText('ReadAll')).toBeInTheDocument();
  });

  it('Add role toggles the inline role form', () => {
    const props = wrap();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:iam.attachRole') }));
    expect(props.setShowAddRole).toHaveBeenCalledWith(true);
  });
});
