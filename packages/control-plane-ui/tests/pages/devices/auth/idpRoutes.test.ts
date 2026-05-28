import { describe, it, expect } from 'vitest';
import { IDP_LIST_ROUTE, IDP_NEW_ROUTE, idpDetailRoute } from '../../../../src/pages/devices/auth/idpRoutes';

// Centralised IdP route paths — pin them so internal links + breadcrumbs stay
// in sync with the IAM nav location.
describe('idpRoutes', () => {
  it('exposes the canonical list + new paths under /iam', () => {
    expect(IDP_LIST_ROUTE).toBe('/iam/identity-providers');
    expect(IDP_NEW_ROUTE).toBe('/iam/identity-providers/new');
  });
  it('builds a detail path from an id', () => {
    expect(idpDetailRoute('abc')).toBe('/iam/identity-providers/abc');
  });
});
