import { describe, it, expect } from 'vitest';
import { renderWithRouter } from '@/test/test-utils';
import { DeviceListPage } from '@/pages/devices/DeviceListPage';
describe('DeviceListPage', () => {
  it('mounts and renders without crashing', () => {
    expect(() => renderWithRouter(<DeviceListPage />)).not.toThrow();
  });
});
