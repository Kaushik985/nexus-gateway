import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { GlobalTimeRangeBanner } from '../../src/components/GlobalTimeRangeBanner';
import { TimeRangeProvider } from '../../src/context/TimeRangeContext';

function renderBanner() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TimeRangeProvider>
        <GlobalTimeRangeBanner />
      </TimeRangeProvider>
    </I18nextProvider>,
  );
}

describe('GlobalTimeRangeBanner', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('renders the preset buttons on a non-hidden route', () => {
    window.history.pushState({}, '', '/overview');
    renderBanner();
    expect(screen.getByRole('button', { name: '24h' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
  });

  it('hides itself on a hidden route prefix (e.g. /credentials)', () => {
    window.history.pushState({}, '', '/credentials');
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('switches the preset on click', async () => {
    window.history.pushState({}, '', '/overview');
    const user = userEvent.setup();
    renderBanner();
    await user.click(screen.getByRole('button', { name: '30d' }));
    // 30d button becomes the active one (its class set carries the active modifier).
    const btn = screen.getByRole('button', { name: '30d' });
    expect(btn.className).toMatch(/[Aa]ctive/);
  });
});
