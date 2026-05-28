import { describe, it, expect } from 'vitest';
import { renderWithRouter } from '@/test/test-utils';
import { DeviceAuthSettingsPage } from '@/pages/devices/auth/DeviceAuthSettingsPage';
describe('DeviceAuthSettingsPage', () => {
  it('mounts and renders without crashing', () => {
    expect(() => renderWithRouter(<DeviceAuthSettingsPage />)).not.toThrow();
  });
});
