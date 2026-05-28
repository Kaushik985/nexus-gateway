import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Sidebar } from '@/components/ui/Sidebar/Sidebar';

const auth = vi.hoisted(() => ({ value: { permissions: [] as string[], keyName: 'alice', email: 'a@x.io', logout: () => {} } }));
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({ brand: { productName: 'Nexus' }, mode: 'light', resolvedMode: 'light', setMode: vi.fn(), themeId: 'default', setThemeId: vi.fn() }),
}));
vi.mock('@/api/services/alerts/alerts', () => ({ alertsApi: { list: vi.fn().mockResolvedValue({ data: [], total: 0 }) } }));

function renderAt(route: string, permissions: string[]) {
  auth.value = { ...auth.value, permissions };
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[route]}>
        <Sidebar />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => { auth.value = { permissions: [], keyName: 'alice', email: 'a@x.io', logout: () => {} }; });

  it('renders nav links and marks the active route (itemMatchesRoute)', () => {
    renderAt('/', []);
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    // Home/dashboard ('/') should be the current page at route '/'.
    expect(links.some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('permission-gates nav items: granting an action reveals more links', () => {
    const { unmount } = renderAt('/', []);
    const withoutPerms = screen.getAllByRole('link').length;
    unmount();
    renderAt('/', ['admin:traffic-log.read', 'admin:analytics.read', 'admin:credential.read', 'admin:provider.read']);
    const withPerms = screen.getAllByRole('link').length;
    expect(withPerms).toBeGreaterThan(withoutPerms);
  });

  it('renders in collapsed mode without crashing', () => {
    auth.value = { ...auth.value, permissions: [] };
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/analytics']}>
          <Sidebar collapsed onToggle={vi.fn()} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('toggling a collapsible section header flips its aria-expanded state', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    renderAt('/', ['admin:traffic-log.read', 'admin:analytics.read', 'admin:credential.read', 'admin:provider.read', 'admin:node.read', 'admin:settings.read']);
    const sectionToggles = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'));
    expect(sectionToggles.length).toBeGreaterThan(0);
    const toggle = sectionToggles[0];
    const before = toggle.getAttribute('aria-expanded');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).not.toBe(before);
  });
});
