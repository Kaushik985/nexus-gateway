import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { UpdateBanner } from '@/components/UpdateBanner';
import type { StatusSnapshot } from '@/api/agent';
const st = (over: Record<string, unknown>) => ({ agent: { updateAvailable: true, downloadURL: 'https://dl/x.pkg', ...over } } as unknown as StatusSnapshot);
const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
describe('UpdateBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('is hidden when no update is available', () => {
    const { container } = wrap(<UpdateBanner status={st({ updateAvailable: false })} />);
    expect(container.firstChild).toBeNull();
  });
  it('is hidden when there is no download URL', () => {
    const { container } = wrap(<UpdateBanner status={st({ downloadURL: '' })} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the banner and opens the download URL on Install', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    wrap(<UpdateBanner status={st({})} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('updateBanner.install') }));
    expect(open).toHaveBeenCalledWith('https://dl/x.pkg', '_blank');
  });
  it('dismiss sets a 24h cooldown and hides the banner', () => {
    const { container } = wrap(<UpdateBanner status={st({})} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('updateBanner.dismiss') }));
    expect(localStorage.getItem('updateBanner.dismissedUntil')).toBeTruthy();
    expect(container.firstChild).toBeNull();
  });
});
