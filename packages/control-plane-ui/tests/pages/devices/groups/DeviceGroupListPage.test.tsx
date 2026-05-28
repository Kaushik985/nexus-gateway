import { describe, it, expect } from 'vitest';
import { renderWithRouter } from '@/test/test-utils';
import { DeviceGroupListPage } from '@/pages/devices/groups/DeviceGroupListPage';
describe('DeviceGroupListPage', () => {
  it('mounts and renders without crashing', () => {
    expect(() => renderWithRouter(<DeviceGroupListPage />)).not.toThrow();
  });
});
