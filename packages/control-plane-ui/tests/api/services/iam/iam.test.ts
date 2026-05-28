import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { iamApi } from '../../../../src/api/services/iam/iam';

vi.mock('../../../../src/api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

describe('iamApi — users', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

  it('CRUD users routes to /api/admin/users', () => {
    iamApi.listUsers({ page: '1' });
    iamApi.getUser('u1');
    iamApi.createUser({ email: 'a@b.c' } as never);
    iamApi.updateUser('u1', { displayName: 'X' } as never);
    iamApi.deleteUser('u1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/users', { page: '1' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/users/u1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/users', { email: 'a@b.c' });
    expect(m.put).toHaveBeenCalledWith('/api/admin/users/u1', { displayName: 'X' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/users/u1');
  });
});

describe('iamApi — api keys', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

  it('lifecycle: create/patch/regenerate/rotate/retire/delete', () => {
    iamApi.listApiKeys({ owner: 'o' });
    iamApi.createApiKey({ name: 'k' } as never);
    iamApi.patchApiKey('k1', { name: 'k2' } as never);
    iamApi.regenerateApiKey('k1');
    iamApi.rotateApiKey('k1', { expiresAt: '2027-01-01' });
    iamApi.retireApiKey('k1', 'unavailable');
    iamApi.deleteApiKey('k1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/api-keys', { owner: 'o' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/api-keys', { name: 'k' });
    expect(m.patch).toHaveBeenCalledWith('/api/admin/api-keys/k1', { name: 'k2' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/api-keys/k1/regenerate', {});
    expect(m.post).toHaveBeenCalledWith('/api/admin/api-keys/k1/rotate', { expiresAt: '2027-01-01' });
    // retire forwards the targetStatus enum verbatim
    expect(m.put).toHaveBeenCalledWith('/api/admin/api-keys/k1/retire', { targetStatus: 'unavailable' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/api-keys/k1');
  });

  it('rotate without a body defaults to {} and retire defaults to expired', () => {
    iamApi.rotateApiKey('k1');
    iamApi.retireApiKey('k1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/api-keys/k1/rotate', {});
    expect(m.put).toHaveBeenCalledWith('/api/admin/api-keys/k1/retire', { targetStatus: 'expired' });
  });

  it('patchMe targets the self endpoint', () => {
    iamApi.patchMe({ displayName: 'Me' } as never);
    expect(m.patch).toHaveBeenCalledWith('/api/admin/me', { displayName: 'Me' });
  });
});

describe('iamApi — policies', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

  it('CRUD + attachments routes to /api/admin/iam/policies', () => {
    iamApi.listPolicies();
    iamApi.getPolicy('p1');
    iamApi.createPolicy({ name: 'P' } as never);
    iamApi.updatePolicy('p1', { name: 'P2' } as never);
    iamApi.deletePolicy('p1');
    iamApi.getPolicyAttachments('p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/policies', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/policies/p1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/iam/policies', { name: 'P' });
    expect(m.put).toHaveBeenCalledWith('/api/admin/iam/policies/p1', { name: 'P2' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/iam/policies/p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/policies/p1/attachments');
  });
});

describe('iamApi — groups + members + group policies', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

  it('group CRUD', () => {
    iamApi.listGroups();
    iamApi.getGroup('g1');
    iamApi.createGroup({ name: 'G' } as never);
    iamApi.updateGroup('g1', { name: 'G2' } as never);
    iamApi.deleteGroup('g1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/groups', undefined);
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/groups/g1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/iam/groups', { name: 'G' });
    expect(m.put).toHaveBeenCalledWith('/api/admin/iam/groups/g1', { name: 'G2' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/iam/groups/g1');
  });

  it('membership + group-policy attach/detach nest under the group id', () => {
    iamApi.listGroupMembers('g1', { page: '1' });
    iamApi.addGroupMember('g1', { principalType: 'user', principalId: 'u1' } as never);
    iamApi.removeGroupMember('g1', 'mem1');
    iamApi.addGroupPolicy('g1', { policyId: 'p1' } as never);
    iamApi.removeGroupPolicy('g1', 'att1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/groups/g1/members', { page: '1' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/iam/groups/g1/members', { principalType: 'user', principalId: 'u1' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/iam/groups/g1/members/mem1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/iam/groups/g1/policies', { policyId: 'p1' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/iam/groups/g1/policies/att1');
  });
});

describe('iamApi — principals + simulator + catalog', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

  it('principal policy attach/detach interpolates type + id', () => {
    iamApi.getPrincipalPolicies('user', 'u1', { page: '1' });
    iamApi.attachPrincipalPolicy('user', 'u1', { policyId: 'p1' } as never);
    iamApi.detachPrincipalPolicy('user', 'u1', 'att1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/principals/user/u1/policies', { page: '1' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/iam/principals/user/u1/policies', { policyId: 'p1' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/iam/principals/user/u1/policies/att1');
  });

  it('simulate + action catalog', () => {
    iamApi.simulate({ principalType: 'user' } as never);
    iamApi.getActionCatalog();
    expect(m.post).toHaveBeenCalledWith('/api/admin/iam/simulate', { principalType: 'user' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/iam/action-catalog');
  });
});

describe('iamApi — identity providers + SCIM + group mappings', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

  it('IdP CRUD + probe endpoints', () => {
    iamApi.listIdentityProviders();
    iamApi.getIdentityProvider('i1');
    iamApi.createIdentityProvider({ type: 'oidc' } as never);
    iamApi.updateIdentityProvider('i1', { type: 'oidc' } as never);
    iamApi.testCandidateIdentityProvider({ type: 'oidc' } as never);
    iamApi.testSavedIdentityProvider('i1', { token: 't' });
    iamApi.testSavedIdentityProvider('i1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/identity-providers');
    expect(m.get).toHaveBeenCalledWith('/api/admin/identity-providers/i1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/identity-providers', { type: 'oidc' });
    expect(m.put).toHaveBeenCalledWith('/api/admin/identity-providers/i1', { type: 'oidc' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/identity-providers/test', { type: 'oidc' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/identity-providers/i1/test', { token: 't' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/identity-providers/i1/test', {});
  });

  it('delete appends ?force=true only when force is set', () => {
    iamApi.deleteIdentityProvider('i1');
    iamApi.deleteIdentityProvider('i1', { force: true });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/identity-providers/i1');
    expect(m.delete).toHaveBeenCalledWith('/api/admin/identity-providers/i1?force=true');
  });

  it('SCIM tokens + IdP group mappings nest under the IdP id', () => {
    iamApi.listScimTokens('i1');
    iamApi.createScimToken('i1', 'tok');
    iamApi.revokeScimToken('i1', 's1');
    iamApi.listIdpGroupMappings('i1');
    iamApi.createIdpGroupMapping('i1', { externalGroupId: 'eg', iamGroupId: 'g1' });
    iamApi.deleteIdpGroupMapping('i1', 'mp1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/identity-provider/i1/scim-tokens');
    expect(m.post).toHaveBeenCalledWith('/api/admin/identity-provider/i1/scim-tokens', { name: 'tok' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/identity-provider/i1/scim-tokens/s1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/identity-provider/i1/group-mappings');
    expect(m.post).toHaveBeenCalledWith('/api/admin/identity-provider/i1/group-mappings', { externalGroupId: 'eg', iamGroupId: 'g1' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/identity-provider/i1/group-mappings/mp1');
  });
});
