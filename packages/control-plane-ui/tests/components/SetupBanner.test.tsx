import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

const checkAllSetupComplete = vi.fn();
vi.mock('../../src/pages/setup/SetupWizardPage', () => ({ checkAllSetupComplete: () => checkAllSetupComplete() }));
vi.mock('@/theme/useTheme', () => ({ useTheme: () => ({ brand: { productName: 'Nexus' } }) }));

import { SetupBanner } from '../../src/components/SetupBanner';

function renderBanner() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <SetupBanner />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('SetupBanner', () => {
  beforeEach(() => checkAllSetupComplete.mockReset());

  it('shows the banner with an Open-wizard link while setup is incomplete', async () => {
    checkAllSetupComplete.mockResolvedValue(false);
    renderBanner();
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('link')).toHaveAttribute('href', '/setup');
  });

  it('renders nothing once setup is complete', async () => {
    checkAllSetupComplete.mockResolvedValue(true);
    const { container } = renderBanner();
    // Give the async check a tick; it must stay hidden.
    await waitFor(() => expect(checkAllSetupComplete).toHaveBeenCalled());
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
