import { describe, it, expect } from 'vitest';
import { renderWithRouter } from '@/test/test-utils';
import { IdentityProviderDetailPage } from '@/pages/devices/auth/IdentityProviderDetailPage';
describe('IdentityProviderDetailPage', () => {
  it('mounts and renders without crashing', () => {
    expect(() => renderWithRouter(<IdentityProviderDetailPage />)).not.toThrow();
  });
});
