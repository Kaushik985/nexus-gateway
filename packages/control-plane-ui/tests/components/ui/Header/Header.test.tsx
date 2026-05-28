import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Header } from '@/components/ui/Header/Header';

const setMode = vi.fn();
const setThemeId = vi.fn();
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ keyName: 'alice', logout: vi.fn() }) }));
vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({ mode: 'system', resolvedMode: 'dark', setMode, brand: { productName: 'NexusGW' }, themeId: 'default', setThemeId }),
}));
vi.mock('@/api/services/alerts/alerts', () => ({ alertsApi: { list: vi.fn().mockResolvedValue({ data: [], total: 0 }) } }));

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>);

describe('Header', () => {
  it('renders the brand name + theme/lang toggles', () => {
    wrap(<Header />);
    expect(screen.getByText('NexusGW')).toBeInTheDocument();
    // Theme-mode toggle exposes its mode in the aria-label.
    expect(screen.getByLabelText(/Theme: system/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Language:/)).toBeInTheDocument();
  });

  it('shows the mobile hamburger + fires onMenuToggle', () => {
    const onMenuToggle = vi.fn();
    wrap(<Header isMobile onMenuToggle={onMenuToggle} />);
    fireEvent.click(screen.getByLabelText(i18n.t('common:toggleNav')));
    expect(onMenuToggle).toHaveBeenCalled();
  });

  it('opens the theme-mode menu and selects a mode', async () => {
    const user = userEvent.setup();
    wrap(<Header />);
    await user.click(screen.getByLabelText(/Theme: system/));
    // Radix DropdownMenu renders items as menuitem on open.
    const items = await screen.findAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(0);
    await user.click(items[0]);
    expect(setMode).toHaveBeenCalled();
  });
});
